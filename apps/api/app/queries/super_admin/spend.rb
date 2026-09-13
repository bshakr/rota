module SuperAdmin
  # What every house costs to run, so the product can be priced against a real number.
  #
  # There are exactly two places this app spends money — a text and a Claude call — and each one
  # already wrote the row that records it (see the plan's "Where spend is recorded" decision). This
  # reads those two tables across every house, which is why it lives under SuperAdmin:: and why
  # nothing here is tenant-scoped: reading across houses is the entire point of the surface.
  #
  # A query object, on the convention SuperAdmin::Overview's own comment sets out: app/queries is
  # for reads across every tenant that change nothing, and app/services stays for the things that
  # change one house. Nothing in this file writes. The one parameter it takes is a range key checked
  # against a fixed list before anything is read, so there is no id here for a house admin to
  # smuggle across the boundary either — the allowlist is the only gate, and it runs first.
  #
  # Three things this deliberately refuses to do:
  #
  #   * Blend a settled charge with an estimate. Twilio settles a price minutes after delivery, so
  #     the last day of any range is always partly unpriced. Settled and estimated are separate
  #     figures with separate counts, and the page says which is which.
  #   * Add a non-USD charge into the USD total. Twilio bills per destination network and can bill
  #     in another currency; converting would need a rate, and a rate is one more thing to be wrong
  #     about. A foreign charge is reported on its own line instead (BLO-1672's review asked for
  #     this).
  #   * Touch a Float on the way to a total. Money is BigDecimal from the column to the last step,
  #     and becomes a JSON number only when the payload is built.
  #
  # Precision, since a number that renders coarser than it was computed is a decision, not a
  # default: aggregate money serialises at 4 decimals, and every per-unit price — the segment
  # estimate rate, cost per text, cost per title, and the whole unit_economics block — at 6, because
  # a per-unit price here is routinely smaller than the 4th decimal place and rounding it would
  # report a real cost as zero.
  class Spend
    # A range the caller made up. Raised from the constructor so the controller can answer 400
    # before anything is computed or cached.
    class UnknownRange < ArgumentError; end

    # `months` is what "per month" divides by, and what the fixed monthly cost is multiplied by to
    # cover the whole window. It is declared rather than derived: 30 days is charged as one month,
    # 90 as three, and a derived 30/30.437 would make every per-month figure quietly 1.5% high.
    Window = Data.define(:key, :starts_at, :ends_at, :months)

    RANGES = %w[30d 90d 12m].freeze
    DEFAULT_RANGE = "30d"

    # Versioned for the same reason SuperAdmin::Overview's key is: Solid Cache survives a deploy, so
    # without the suffix the first minute after shipping a change to this payload would serve the
    # OLD shape to the NEW page, which is a confusing way to break a dashboard. Bump it whenever the
    # shape changes. The range is appended to it, so each window is its own entry.
    CACHE_KEY = "super_admin/spend/v1".freeze

    # The same 60 seconds the rest of the operator console caches at. Tens of houses, live SQL, and
    # a page nobody reloads twice a second — see the plan's "Aggregation" decision.
    CACHE_TTL = 60.seconds

    # Both vendors bill in dollars and nothing here converts. See the "Currency" decision.
    CURRENCY = "USD"

    MONEY_PRECISION = 4
    UNIT_PRICE_PRECISION = 6

    # What one segment costs when Twilio has not said yet. Twilio's US list price for an outbound
    # SMS segment; override with SMS_ESTIMATED_SEGMENT_COST_USD when the mix is mostly elsewhere.
    # It only ever prices rows the backfill has not settled, so it stops mattering as they settle.
    DEFAULT_SEGMENT_COST_USD = "0.0079".to_d

    # A row with no segment count is a text sent before BLO-1672 added the column. One segment is
    # the floor, not the truth: it understates a long text and never overstates a short one, which
    # is the right direction for a figure a price is set against.
    ASSUMED_SEGMENTS = 1

    # Nearest rank, both of them, so every figure quoted is a house that actually exists.
    PERCENTILES = { median: 50, p90: 90 }.freeze

    # An empty bucket of spend. Every total in this file — a house in a month, a whole month, a
    # whole house, the range — is one of these, summed with `add`, so there is one definition of
    # what a total contains and no second place to forget a column.
    ZERO_BUCKET = {
      texts_sent: 0,
      segments: 0,
      texts_settled: 0,
      sms_cost_settled: BigDecimal(0),
      texts_estimated: 0,
      estimated_segments: 0,
      # unit => BigDecimal, and empty in the normal case. See the "Currency" note above.
      other_currencies: {}.freeze,
      claude_calls: 0,
      claude_tokens_in: 0,
      claude_tokens_out: 0,
      claude_cost: BigDecimal(0),
      claude_calls_unpriced: 0,
      titles_classified: 0
    }.freeze

    # Every text in the window, bucketed by house, UTC calendar month, and the currency it was
    # billed in.
    #
    # The classification in the CTE is the whole argument of this file, so it is written once there
    # and only counted below:
    #
    #   settled   — Twilio was asked and answered. A real charge, whatever the row's status says:
    #               a message that failed after Twilio accepted it can still cost money.
    #   was_sent  — the carrier took it. `sent` and `delivered` only: a `failed` row is one Twilio
    #               rejected and did not charge for, and `pending`/`sending` never left the building.
    #   estimated — went out, has the SID that proves Twilio accepted it, and nobody has been told
    #               the price yet. This is the only bucket the per-segment rate is applied to.
    #
    # A row that is neither settled nor estimated costs zero, and that is a statement, not a
    # fallback: a rejected text is free.
    SMS_SQL = <<~SQL.freeze
      WITH classified AS (
        SELECT
          members.group_id AS group_id,
          DATE_TRUNC('month', sms_messages.created_at) AS month_start,
          COALESCE(NULLIF(UPPER(sms_messages.price_unit), ''), 'USD') AS price_unit,
          COALESCE(sms_messages.num_segments, :assumed_segments) AS segments,
          sms_messages.price AS price,
          sms_messages.status IN ('sent', 'delivered') AS was_sent,
          sms_messages.price_fetched_at IS NOT NULL AND sms_messages.price IS NOT NULL AS settled,
          sms_messages.twilio_sid IS NOT NULL AS accepted
        FROM sms_messages
        INNER JOIN members ON members.id = sms_messages.member_id
        WHERE sms_messages.created_at >= :starts_at
          AND sms_messages.created_at <= :ends_at
      )
      SELECT
        group_id,
        month_start,
        price_unit,
        COUNT(*) FILTER (WHERE was_sent) AS texts_sent,
        COALESCE(SUM(segments) FILTER (WHERE was_sent), 0) AS segments,
        COUNT(*) FILTER (WHERE settled) AS texts_settled,
        COALESCE(SUM(price) FILTER (WHERE settled), 0) AS sms_cost_settled,
        COUNT(*) FILTER (WHERE was_sent AND accepted AND NOT settled) AS texts_estimated,
        COALESCE(SUM(segments) FILTER (WHERE was_sent AND accepted AND NOT settled), 0) AS estimated_segments
      FROM classified
      GROUP BY group_id, month_start, price_unit
    SQL

    # Every Claude call in the window, bucketed the same way.
    #
    # Failures are counted and priced with the rest: Anthropic charges for a request it accepted
    # and then rate-limited, and a house whose calendar never manages to classify is a house paying
    # for nothing. Only `titles_classified` narrows to succeeded calls, because a failed call
    # classified no titles however many it was handed.
    #
    # `cost_usd` is null when the model was missing from the rate table (see AiCall.cost_usd_for).
    # Summing it as zero would read as free, so those calls are counted separately and the page can
    # say the total is short.
    AI_SQL = <<~SQL.freeze
      SELECT
        ai_calls.group_id AS group_id,
        DATE_TRUNC('month', ai_calls.created_at) AS month_start,
        COUNT(*) AS claude_calls,
        COALESCE(SUM(ai_calls.input_tokens), 0)
          + COALESCE(SUM(ai_calls.cache_creation_input_tokens), 0)
          + COALESCE(SUM(ai_calls.cache_read_input_tokens), 0) AS claude_tokens_in,
        COALESCE(SUM(ai_calls.output_tokens), 0) AS claude_tokens_out,
        COALESCE(SUM(ai_calls.cost_usd), 0) AS claude_cost,
        COUNT(*) FILTER (WHERE ai_calls.cost_usd IS NULL) AS claude_calls_unpriced,
        COALESCE(SUM(ai_calls.items_count) FILTER (WHERE ai_calls.succeeded), 0) AS titles_classified
      FROM ai_calls
      WHERE ai_calls.created_at >= :starts_at
        AND ai_calls.created_at <= :ends_at
      GROUP BY ai_calls.group_id, DATE_TRUNC('month', ai_calls.created_at)
    SQL

    class << self
      # Uncached. What specs and anything that wants today's figures rather than the last minute's
      # should call.
      def call(range: nil)
        new(range: range).call
      end

      def cached(range: nil)
        new(range: range).cached
      end

      def cache_key(range)
        "#{CACHE_KEY}/#{range}"
      end

      # The window, resolved against the clock now, and inclusive at both ends: a row stamped
      # exactly at either boundary is counted once, in this window.
      #
      # The ranges are relative to the operator's UTC clock rather than to any house's, because
      # this is a cross-house total and there is no one house whose midnight it could belong to.
      # The monthly buckets are UTC calendar months for the same reason.
      def window_for(range)
        key = range.presence || DEFAULT_RANGE
        raise UnknownRange, "#{key.inspect} is not a known range (#{RANGES.join(', ')})" unless RANGES.include?(key)

        ends_at = Time.current
        case key
        when "30d" then Window.new(key: key, starts_at: ends_at - 30.days, ends_at: ends_at, months: 1)
        when "90d" then Window.new(key: key, starts_at: ends_at - 90.days, ends_at: ends_at, months: 3)
        else
          # Twelve whole calendar months, this one included, so the monthly series has no half month
          # at its far end to mislead a bar chart.
          Window.new(key: key, starts_at: (ends_at - 11.months).beginning_of_month, ends_at: ends_at, months: 12)
        end
      end
    end

    attr_reader :window, :segment_cost, :fixed_monthly_cost

    def initialize(range: nil)
      # Raises before anything is read or cached, so a bad range costs one comparison.
      @window = self.class.window_for(range)
      @segment_cost = parse_money(ENV["SMS_ESTIMATED_SEGMENT_COST_USD"], "SMS_ESTIMATED_SEGMENT_COST_USD") ||
                      DEFAULT_SEGMENT_COST_USD
      # Optional by design: unset means the page shows no allocated line at all rather than a zero
      # that could be read as "hosting is free". See the "Fixed costs" decision.
      @fixed_monthly_cost = parse_money(ENV["FIXED_MONTHLY_COST_USD"], "FIXED_MONTHLY_COST_USD")
    end

    # The key is the range and nothing else. Changing FIXED_MONTHLY_COST_USD therefore takes up to
    # a minute to show, which is the right trade: keying on the env values too would mean a cache
    # entry per pricing experiment, and an operator typing a candidate price is doing it on the
    # page's own calculator (BLO-1684), not here.
    def cached
      Rails.cache.fetch(self.class.cache_key(window.key), expires_in: CACHE_TTL) { call }
    end

    def call
      cells = cells_by_house_and_month
      total = cells.values.reduce(ZERO_BUCKET) { |running, cell| add(running, cell) }
      houses = houses_from(cells)
      allocated = allocated_fixed_cost(houses.length)

      {
        range: window.key,
        currency: CURRENCY,
        starts_at: window.starts_at.iso8601,
        ends_at: window.ends_at.iso8601,
        months_in_range: window.months,
        fixed_monthly_cost_usd: money(fixed_monthly_cost),
        sms_estimated_segment_cost_usd: unit_price(segment_cost),
        houses_active: houses.length,
        houses_total: Group.count,
        totals: figures(total),
        months: month_rows(cells),
        houses: houses.map { |house| house_row(house, allocated) },
        unit_economics: unit_economics(houses, total)
      }
    end

    private

    # --- reading ----------------------------------------------------------------------------------

    # { [group_id, month (a Date on the 1st)] => bucket }. One pass over each table, folded in
    # Ruby, because both roll-ups the page needs — by month and by house — come out of the same
    # cells, and tens of houses over twelve months is a few hundred of them.
    def cells_by_house_and_month
      cells = Hash.new(ZERO_BUCKET)

      each_row(SMS_SQL, "SuperAdmin::Spend SMS") do |row|
        key = cell_key(row)
        cells[key] = add(cells[key], sms_bucket(row))
      end

      each_row(AI_SQL, "SuperAdmin::Spend Claude") do |row|
        key = cell_key(row)
        cells[key] = add(cells[key], ai_bucket(row))
      end

      cells
    end

    def each_row(sql, name, &)
      bound = ApplicationRecord.sanitize_sql_array(
        [ sql, { starts_at: window.starts_at, ends_at: window.ends_at, assumed_segments: ASSUMED_SEGMENTS } ]
      )
      ApplicationRecord.connection.select_all(bound, name).each(&)
    end

    def cell_key(row)
      [ integer(row["group_id"]), month_of(row["month_start"]) ]
    end

    def sms_bucket(row)
      unit = row["price_unit"].to_s
      settled = decimal(row["sms_cost_settled"])

      ZERO_BUCKET.merge(
        texts_sent: integer(row["texts_sent"]),
        segments: integer(row["segments"]),
        texts_settled: integer(row["texts_settled"]),
        # Only dollars reach the headline figure. Anything else is carried beside it, unconverted.
        sms_cost_settled: unit == CURRENCY ? settled : BigDecimal(0),
        texts_estimated: integer(row["texts_estimated"]),
        estimated_segments: integer(row["estimated_segments"]),
        other_currencies: unit == CURRENCY || settled.zero? ? {} : { unit => settled }
      )
    end

    def ai_bucket(row)
      ZERO_BUCKET.merge(
        claude_calls: integer(row["claude_calls"]),
        claude_tokens_in: integer(row["claude_tokens_in"]),
        claude_tokens_out: integer(row["claude_tokens_out"]),
        claude_cost: decimal(row["claude_cost"]),
        claude_calls_unpriced: integer(row["claude_calls_unpriced"]),
        titles_classified: integer(row["titles_classified"])
      )
    end

    # The one way two buckets are combined. `other_currencies` is a hash of its own, so it is
    # merged as one rather than added as a number.
    def add(left, right)
      left.merge(right) do |key, a, b|
        key == :other_currencies ? a.merge(b) { |_unit, x, y| x + y } : a + b
      end
    end

    # --- rows -------------------------------------------------------------------------------------

    # Every calendar month the window touches, in order, including the ones nothing happened in: a
    # bar chart with a hole in it reads as missing data rather than as a quiet month.
    def month_rows(cells)
      by_month = cells.each_with_object(Hash.new(ZERO_BUCKET)) do |((_group_id, month), cell), totals|
        totals[month] = add(totals[month], cell)
      end

      months_in_window.map do |month|
        { month: month.strftime("%Y-%m"), starts_on: month.iso8601 }.merge(figures(by_month[month]))
      end
    end

    def months_in_window
      first = window.starts_at.to_date.beginning_of_month
      last = window.ends_at.to_date.beginning_of_month
      months = []
      cursor = first
      while cursor <= last
        months << cursor
        cursor = cursor.next_month
      end
      months
    end

    # Internal, BigDecimal shape — the unit economics are computed off these before anything is
    # rounded for JSON. A house appears only if it spent something in the window (or tried to:
    # "active" is any text or any Claude call, which is the same definition the fixed cost is
    # divided across).
    def houses_from(cells)
      by_house = cells.each_with_object(Hash.new(ZERO_BUCKET)) do |((group_id, _month), cell), totals|
        totals[group_id] = add(totals[group_id], cell)
      end

      names = Group.where(id: by_house.keys).pluck(:id, :name, :slug).index_by(&:first)
      # "Active" the way the rest of the app means it: on the roll, not opted out. A current count,
      # not a historical one — it answers "what does this house cost per person today".
      members = Member.contactable.where(group_id: by_house.keys).group(:group_id).count

      by_house.filter_map do |group_id, bucket|
        id, name, slug = names[group_id]
        # A house deleted between the two queries. Its spend stays in the totals, where it happened.
        next if id.nil?

        { group_id: id, name: name, slug: slug, bucket: bucket,
          active_members: members.fetch(group_id, 0), total: total_of(bucket) }
      end.sort_by { |house| [ -house[:total], house[:name].to_s ] }
    end

    def house_row(house, allocated)
      per_member = house[:active_members].positive? ? house[:total] / house[:active_members] : nil

      {
        group_id: house[:group_id],
        name: house[:name],
        slug: house[:slug]
      }.merge(figures(house[:bucket])).merge(
        active_members: house[:active_members],
        total_per_active_member: unit_price(per_member),
        # Its own field, never folded into `total`: it is an allocation, not a charge this house
        # incurred, and the two must not be mistaken for each other.
        allocated_fixed_cost: money(allocated)
      )
    end

    # --- figures ----------------------------------------------------------------------------------

    def figures(bucket)
      estimated = estimated_cost(bucket)

      {
        texts_sent: bucket[:texts_sent],
        segments: bucket[:segments],
        texts_settled: bucket[:texts_settled],
        sms_cost_settled: money(bucket[:sms_cost_settled]),
        texts_estimated: bucket[:texts_estimated],
        sms_cost_estimated: money(estimated),
        sms_cost: money(bucket[:sms_cost_settled] + estimated),
        sms_cost_other_currencies: other_currencies(bucket),
        claude_calls: bucket[:claude_calls],
        claude_tokens_in: bucket[:claude_tokens_in],
        claude_tokens_out: bucket[:claude_tokens_out],
        claude_cost: money(bucket[:claude_cost]),
        claude_calls_unpriced: bucket[:claude_calls_unpriced],
        titles_classified: bucket[:titles_classified],
        total: money(total_of(bucket))
      }
    end

    def estimated_cost(bucket)
      segment_cost * bucket[:estimated_segments]
    end

    def total_of(bucket)
      bucket[:sms_cost_settled] + estimated_cost(bucket) + bucket[:claude_cost]
    end

    def other_currencies(bucket)
      bucket[:other_currencies].sort.map { |unit, amount| { unit: unit, amount: money(amount) } }
    end

    # --- fixed cost -------------------------------------------------------------------------------

    # One house's share of the whole window's fixed cost: the monthly figure multiplied by the
    # months in the range, then split evenly across the houses that were active in it. Nil when no
    # figure is configured, and nil when nobody was active — there is nobody to divide among, and
    # zero would read as "hosting was free this month".
    def allocated_fixed_cost(active_houses)
      return nil if fixed_monthly_cost.nil? || active_houses.zero?

      fixed_monthly_cost * window.months / active_houses
    end

    # --- unit economics ---------------------------------------------------------------------------

    # The numbers a price gets set against. Every one of them can legitimately have no answer — no
    # houses, no members, no texts — and each says nil rather than zero, NaN or Infinity, because
    # "nothing to measure" and "measured zero" are different answers to a pricing question.
    # The two per-unit prices divide the range's own totals rather than re-summing the house rows,
    # so they can never disagree with the headline figures above them. The two percentile pairs are
    # about the spread across houses and have to walk the rows.
    def unit_economics(houses, total)
      texts = total[:texts_sent]
      titles = total[:titles_classified]
      sms = total[:sms_cost_settled] + estimated_cost(total)
      # Houses with nobody left to text are not in the per-member spread at all. They would have to
      # be divided by zero to join it, and dropping them is the only reading that is not a lie.
      housed = houses.select { |house| house[:active_members].positive? }

      {
        cost_per_house_per_month: percentiles(houses.map { |house| house[:total] / window.months }),
        cost_per_active_member_per_month: percentiles(
          housed.map { |house| house[:total] / house[:active_members] / window.months }
        ),
        cost_per_text_sent: unit_price(texts.positive? ? sms / texts : nil),
        cost_per_title_classified: unit_price(titles.positive? ? total[:claude_cost] / titles : nil),
        houses_measured: houses.length,
        houses_with_active_members: housed.length
      }
    end

    # Nearest rank, and nothing else: sort ascending, take the value at rank ceil(p/100 × n). Every
    # figure returned is therefore a house that exists, never an interpolation between two — which
    # is what you want when the next question is "which house is that?". With one house it is that
    # house twice; with two, the median is the cheaper of them.
    #
    # The rank is computed in BigDecimal on purpose. In Float, 0.9 × 10 is 9.000000000000002, whose
    # ceiling is 10 — the p90 of ten houses would silently become the maximum.
    def percentiles(values)
      sorted = values.sort
      PERCENTILES.transform_values { |percent| unit_price(percentile(sorted, percent)) }
    end

    def percentile(sorted, percent)
      return nil if sorted.empty?

      rank = (BigDecimal(percent) * sorted.length / 100).ceil
      sorted[[ rank, 1 ].max - 1]
    end

    # --- coercion and serialisation ---------------------------------------------------------------

    # Aggregate money, as a JSON number. BigDecimal serialises as a *string* through Rails' encoder,
    # and a client that has to parse its numbers back out of strings ends up doing Float arithmetic
    # anyway — so the conversion happens once, here, after every sum is final.
    def money(value)
      value.nil? ? nil : value.round(MONEY_PRECISION).to_f
    end

    # A per-unit price. Six decimals, matching ai_calls.cost_usd, because one segment costs less
    # than a hundredth of a cent and four decimals would report a real cost as zero.
    def unit_price(value)
      value.nil? ? nil : value.round(UNIT_PRICE_PRECISION).to_f
    end

    def integer(value)
      value.to_i
    end

    # The adapter may hand back a numeric column already cast or still as the string libpq sent.
    # Going through to_s costs nothing and means neither case can turn into a Float on the way in.
    def decimal(value)
      value.nil? ? BigDecimal(0) : BigDecimal(value.to_s)
    end

    def month_of(value)
      value.is_a?(String) ? Date.parse(value) : value.to_date
    end

    # An operator-set price that is not a number is a typo, and a typo must not take the page down
    # or, worse, be reported as a real cost. Say so in the log and carry on with no figure.
    def parse_money(raw, name)
      value = raw.to_s.strip
      return nil if value.empty?

      parsed = BigDecimal(value)
      return parsed unless parsed.negative?

      Rails.logger.warn("#{name}=#{value.inspect} is negative; ignoring it")
      nil
    rescue ArgumentError
      Rails.logger.warn("#{name}=#{value.inspect} is not a number; ignoring it")
      nil
    end
  end
end
