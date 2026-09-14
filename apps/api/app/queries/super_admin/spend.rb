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
  #   * Add a charge billed in something other than pounds into the pound total. Twilio bills per
  #     destination network and can bill in another currency; converting THAT would need Twilio's
  #     own rate for that destination, which is a fact we do not have. Such a charge is reported on
  #     its own line instead (BLO-1672's review asked for this). Anthropic is the one exception and
  #     it is an explicit one: see the Currency note below.
  #   * Touch a Float on the way to a total. Money is BigDecimal from the column to the last step,
  #     and becomes a JSON number only when the payload is built.
  #
  # Currency. Everything this emits is GBP, because the business is in the UK and Twilio bills the
  # account in GBP — which the old USD-only version could not see, so production showed a settled
  # total of zero next to real charges. Anthropic still bills in dollars, and dollars are the one
  # thing here that has to cross a currency. The only honest way across is a rate somebody decided
  # on, so SPEND_GBP_PER_USD is configuration rather than a lookup: it is published in the payload
  # beside the figures it moved, and when it is unset the Claude figure is reported as dollars
  # (`claude_usd`), the pound figure is nil rather than zero, and every combined total leaves it
  # out under `claude_unconverted`. Nil rather than zero because "Claude was free" is the most
  # expensive thing this page could say wrongly. No rate is ever invented and none is ever fetched:
  # an FX rate that moved under a cached total would make two loads of the same page disagree.
  #
  # Precision, since a number that renders coarser than it was computed is a decision and not a
  # default: every money figure here serialises at 6 decimals, which is the precision of the columns
  # it is summed from (`ai_calls.cost_usd` is decimal(12,6), `sms_messages.price` decimal(10,5)).
  # One rule for totals and per-unit prices alike, so a per-house total and the cost per text it
  # implies can never be rounded to two different truths. Six is not decoration at this scale: a
  # single SMS segment costs under a hundredth of a cent, and four decimals reported a real cost as
  # zero.
  class Spend
    # A range the caller made up. Raised from the constructor so the controller can answer 400
    # before anything is computed or cached.
    class UnknownRange < ArgumentError; end

    # `months` is what "per month" divides by, and what the fixed monthly cost is multiplied by to
    # cover the whole window. It is the window's real length in average calendar months, carried as
    # a BigDecimal and never rounded before it is used.
    #
    # It used to be a declared whole number — 1, 3, 12 — and that was wrong in the direction nobody
    # would notice: the 12m window is 365 days, which is 11.99 average months, not 12, so every
    # per-month figure read about 5% low and the allocated fixed cost about 5% high. A divisor that
    # is almost right is worse than an awkward one, because the page looks fine.
    Window = Data.define(:key, :starts_at, :ends_at, :months)

    # Each range is an exact number of days ending now. Uniform on purpose: three windows measured
    # the same way, none of them snapped to a calendar boundary, so `months` below is a true
    # division rather than three special cases.
    RANGE_DAYS = { "30d" => 30, "90d" => 90, "12m" => 365 }.freeze
    RANGES = RANGE_DAYS.keys.freeze
    DEFAULT_RANGE = "30d"

    # The average calendar month, 365.25 / 12. The divisor for every per-month figure, so a month
    # means the same length whichever range is asked for and whichever months it happens to cover.
    AVERAGE_MONTH_DAYS = "30.4375".to_d

    # Versioned for the same reason SuperAdmin::Overview's key is: Solid Cache survives a deploy, so
    # without the suffix the first minute after shipping a change would serve the OLD payload to the
    # NEW page, which is a confusing way to break a dashboard. The range is appended, so each window
    # is its own entry.
    #
    # Bump it whenever the payload changes — its SHAPE or its VALUES. A field added or renamed is
    # the obvious case; a figure that now renders to six decimals instead of four, or divides by a
    # different number of months, is the one worth naming, because the old entry stays perfectly
    # parseable and is simply wrong.
    #
    # v2: texts_unpriceable added, houses_active renamed to houses_with_spend, money at 6 decimals
    # rather than 4, and months_in_range became the window's true length rather than a whole number.
    # v3: the reporting currency became GBP. Every money figure changed VALUE without changing its
    # name, which is exactly the case this suffix exists for — a v2 entry parses perfectly and is a
    # dollar figure wearing a pound sign. The `_usd` fields were renamed `_gbp` alongside it, and
    # gbp_per_usd, claude_unconverted, claude_usd and sms_estimated_segment_cost_from_settled added.
    CACHE_KEY = "super_admin/spend/v3".freeze

    # The same 60 seconds the rest of the operator console caches at. Tens of houses, live SQL, and
    # a page nobody reloads twice a second — see the plan's "Aggregation" decision.
    CACHE_TTL = 60.seconds

    # What this page reports in, and what Twilio bills the account in. See the Currency note on
    # the class. Decided 2026-09-14.
    CURRENCY = "GBP"

    # The currency Anthropic bills in, and the only one SPEND_GBP_PER_USD is ever applied to.
    CLAUDE_CURRENCY = "USD"

    # One rule for every money figure, totals and per-unit prices alike. See the note on the class.
    MONEY_PRECISION = 6

    # What one segment costs when Twilio has not said yet, and no settled sample is big enough to
    # measure it from. Override with SMS_ESTIMATED_SEGMENT_COST_GBP.
    #
    # Twilio publishes no GBP list price: https://www.twilio.com/en-us/sms/pricing/gb quotes UK
    # outbound SMS at $0.056 a segment (USD, read 2026-09-14), and this account is billed in
    # pounds at a rate that page does not give. So this is an approximation, and it is set from
    # what the account has actually been charged rather than from the list: production's settled
    # rows are £0.08465 and £0.12697, which divide by their 2 and 3 segments to £0.042 each.
    # Rounded down to 0.04 because it is a placeholder — the measured rate below replaces it as
    # soon as twenty texts have settled, and that is the figure meant to be used.
    #
    # It matters less as the backfill settles rows, but it never stops mattering: a row that aged
    # out of Twilio's retention before anyone asked is priced by this rate for good, which is what
    # `texts_unpriceable` counts.
    DEFAULT_SEGMENT_COST_GBP = "0.04".to_d

    # How far back the measured segment rate looks, and how many settled texts it needs before it
    # will speak. Ninety days because the rate is meant to be "what a segment costs LATELY" — the
    # 12m window must not price today's unsettled texts at last autumn's rate — and twenty because
    # below that one three-segment text moves the mean more than the mix does.
    SETTLED_SAMPLE_DAYS = 90
    SETTLED_SAMPLE_MINIMUM = 20

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
      # Accepted, asked about, and never going to be priced: past Twilio's retention. Keeps the
      # estimate for good, so it is counted apart from the rows that are only waiting their turn.
      texts_unpriceable: 0,
      estimated_segments: 0,
      # unit => BigDecimal, and empty in the normal case. See the "Currency" note above.
      other_currencies: {}.freeze,
      claude_calls: 0,
      claude_tokens_in: 0,
      claude_tokens_out: 0,
      # Dollars, as Anthropic billed them, and named so. Every other money key in this hash is
      # pounds; the conversion happens once on the way out (see `claude_gbp`), so nothing in here
      # is ever a mix of the two.
      claude_cost_usd: BigDecimal(0),
      claude_calls_unpriced: 0,
      titles_classified: 0
    }.freeze

    # Every text in the window, bucketed by house, UTC calendar month, and the currency it was
    # billed in.
    #
    # The classification in the CTE is the whole argument of this file, so it is written once there
    # and only counted below. The one question that decides everything is "did Twilio bill us", and
    # the SID is the only honest answer to it:
    #
    #   accepted    — Twilio gave us a SID, which it only does for a message it took and charged
    #                 for. NOT the row's status: `undelivered` maps to `failed` (see
    #                 Webhooks::TwilioStatusController::TERMINAL_STATUSES), and a text the carrier
    #                 rejected after Twilio accepted it is billed exactly like one that arrived.
    #                 A submit-time rejection never gets a SID — SendSmsJob writes the SID in the
    #                 same UPDATE that sets `sent` — and so is free, which is the real meaning of
    #                 "a text Twilio rejected costs nothing".
    #   settled     — asked and answered: price_fetched_at stamped and a price present. The charge.
    #   unpriceable — asked, and no answer is ever coming: stamped with the price still null, which
    #                 is Sms::PriceBackfill marking a row that aged out of Twilio's retention. It
    #                 keeps the estimate forever, so it is counted apart from rows that are merely
    #                 waiting — otherwise the page shows an estimate that will never resolve and
    #                 nobody can tell it from one that will.
    #   estimated   — not asked yet. The estimate now, a real price later.
    #
    # Cost is drawn from `accepted` and nothing else, so the settled figure and the estimate cover
    # the same population. They did not always: the estimate used to require `sent`/`delivered`,
    # which meant a carrier-rejected text cost zero until the backfill settled it and then jumped
    # to a real charge — the same row, priced two different ways depending only on how recently it
    # had been asked about.
    SMS_SQL = <<~SQL.freeze
      WITH classified AS (
        SELECT
          members.group_id AS group_id,
          DATE_TRUNC('month', sms_messages.created_at) AS month_start,
          COALESCE(NULLIF(UPPER(sms_messages.price_unit), ''), :currency) AS price_unit,
          COALESCE(sms_messages.num_segments, :assumed_segments) AS segments,
          sms_messages.price AS price,
          sms_messages.twilio_sid IS NOT NULL AS accepted,
          sms_messages.price_fetched_at IS NOT NULL AS asked,
          sms_messages.price_fetched_at IS NOT NULL AND sms_messages.price IS NOT NULL AS settled
        FROM sms_messages
        INNER JOIN members ON members.id = sms_messages.member_id
        WHERE sms_messages.created_at >= :starts_at
          AND sms_messages.created_at <= :ends_at
      )
      SELECT
        group_id,
        month_start,
        price_unit,
        COUNT(*) FILTER (WHERE accepted) AS texts_sent,
        COALESCE(SUM(segments) FILTER (WHERE accepted), 0) AS segments,
        -- settled, estimated and unpriceable partition `accepted` exactly, so the three of them sum
        -- to texts_sent and none can exceed it. That holds because a price is only ever written by
        -- Sms::PriceBackfill, which walks SmsMessage.awaiting_price — a scope that requires a SID.
        -- A settled row therefore always has one. The page can safely render "N of M" from these.
        COUNT(*) FILTER (WHERE settled) AS texts_settled,
        COALESCE(SUM(price) FILTER (WHERE settled), 0) AS sms_cost_settled,
        COUNT(*) FILTER (WHERE accepted AND NOT settled AND NOT asked) AS texts_estimated,
        COUNT(*) FILTER (WHERE accepted AND NOT settled AND asked) AS texts_unpriceable,
        COALESCE(SUM(segments) FILTER (WHERE accepted AND NOT settled), 0) AS estimated_segments
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
        COALESCE(SUM(ai_calls.cost_usd), 0) AS claude_cost_usd,
        COUNT(*) FILTER (WHERE ai_calls.cost_usd IS NULL) AS claude_calls_unpriced,
        COALESCE(SUM(ai_calls.items_count) FILTER (WHERE ai_calls.succeeded), 0) AS titles_classified
      FROM ai_calls
      WHERE ai_calls.created_at >= :starts_at
        AND ai_calls.created_at <= :ends_at
      GROUP BY ai_calls.group_id, DATE_TRUNC('month', ai_calls.created_at)
    SQL

    # What a segment has actually cost lately, from the charges Twilio settled.
    #
    # Weighted by segments rather than averaged over texts — SUM(price) / SUM(segments) — because a
    # three-segment text is three times the charge, and a mean per text would let one long message
    # drag the rate for every short one. It is deliberately NOT scoped to the window being viewed:
    # the rate answers "what does a segment cost now", which is the same answer on all three pages.
    #
    # Only rows billed in the reporting currency count. A dollar charge is not evidence about a
    # pound rate, and mixing them would produce a mean in no currency at all.
    SETTLED_RATE_SQL = <<~SQL.freeze
      SELECT
        COUNT(*) AS settled_rows,
        COALESCE(SUM(sms_messages.price), 0) AS price,
        COALESCE(SUM(COALESCE(sms_messages.num_segments, :assumed_segments)), 0) AS segments
      FROM sms_messages
      WHERE sms_messages.price_fetched_at IS NOT NULL
        AND sms_messages.price IS NOT NULL
        AND COALESCE(NULLIF(UPPER(sms_messages.price_unit), ''), :currency) = :currency
        AND sms_messages.created_at >= :settled_since
    SQL

    # How the per-segment estimate was arrived at: the rate itself, and the number of settled texts
    # it was measured from (nil when it came from configuration rather than from a measurement).
    Estimate = Data.define(:rate, :settled_rows)

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
      #
      # No range is snapped to a month boundary, so the oldest entry of the `months` series is a
      # partial month in all three — a 365-day window opened mid-September reaches back to the
      # middle of the previous September and draws thirteen bars, the first of them short. That is
      # the honest shape: the alternative was a 12m window that claimed twelve whole months and
      # then divided by a divisor that did not match its own length.
      def window_for(range)
        key = range.presence || DEFAULT_RANGE
        raise UnknownRange, "#{key.inspect} is not a known range (#{RANGES.join(', ')})" unless RANGE_DAYS.key?(key)

        days = RANGE_DAYS.fetch(key)
        ends_at = Time.current

        Window.new(
          key: key,
          starts_at: ends_at - days.days,
          ends_at: ends_at,
          months: BigDecimal(days) / AVERAGE_MONTH_DAYS
        )
      end
    end

    attr_reader :window, :fixed_monthly_cost, :gbp_per_usd

    def initialize(range: nil)
      # Raises before anything is read or cached, so a bad range costs one comparison.
      @window = self.class.window_for(range)
      @configured_segment_cost = parse_money(
        ENV["SMS_ESTIMATED_SEGMENT_COST_GBP"], "SMS_ESTIMATED_SEGMENT_COST_GBP"
      )
      # Optional by design: unset means the page shows no allocated line at all rather than a zero
      # that could be read as "hosting is free". See the "Fixed costs" decision.
      @fixed_monthly_cost = parse_money(ENV["FIXED_MONTHLY_COST_GBP"], "FIXED_MONTHLY_COST_GBP")
      # Nil is a supported state, not a misconfiguration to paper over: until somebody decides a
      # rate, Claude is reported in dollars and left out of the pound totals. See the class note.
      @gbp_per_usd = parse_money(ENV["SPEND_GBP_PER_USD"], "SPEND_GBP_PER_USD")
    end

    # What one unsettled segment is priced at, and where that figure came from.
    #
    # Measured beats configured, which is the opposite of the usual precedence and is the point:
    # a list price is a guess about a mix of destinations, and what this account was actually
    # charged is not a guess at all — same carriers, same message lengths, same account. The
    # configured figure is the fallback for before there is anything to measure, and the payload
    # publishes `sms_estimated_segment_cost_from_settled` so the two are never confused on screen.
    #
    # Memoised, and reached only from #call, so a cache hit does not run the query.
    def estimate
      @estimate ||= measured_estimate ||
                    Estimate.new(rate: @configured_segment_cost || DEFAULT_SEGMENT_COST_GBP,
                                 settled_rows: nil)
    end

    def segment_cost
      estimate.rate
    end

    # Whether Claude's dollars could be expressed in pounds at all. When true, every combined total
    # on this page excludes Claude and `claude_usd` is the only figure for it.
    def claude_unconverted?
      gbp_per_usd.nil?
    end

    # The key is the range and nothing else. Changing FIXED_MONTHLY_COST_GBP or SPEND_GBP_PER_USD
    # therefore takes up to a minute to show, which is the right trade: keying on the env values
    # too would mean a cache entry per pricing experiment, and an operator typing a candidate price
    # is doing it on the page's own calculator (BLO-1684), not here.
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
        # NOT `months.length`, and the two disagree on purpose. This is the window's true length in
        # average calendar months — the divisor for every "per month" figure and the multiplier for
        # the fixed cost — so 30 days is 0.985626, not 1. `months` below is the calendar series a
        # bar chart draws, and a 30-day window straddling a boundary has two entries in it, the
        # older a partial month. Anything dividing by "how long am I looking at" wants this figure;
        # anything drawing bars wants that array. Not money, so not `money()`, but rendered to the
        # same six decimals — and rounded here and only here: every division above used the
        # full-precision value.
        months_in_range: window.months.round(MONEY_PRECISION).to_f,
        # The rate that crossed Anthropic's dollars into this page's pounds, published beside the
        # figures it moved so the page can print "converted at 0.79" and a reader can check the
        # arithmetic. Nil when none is configured, which `claude_unconverted` then says in a word.
        gbp_per_usd: money(gbp_per_usd),
        claude_unconverted: claude_unconverted?,
        fixed_monthly_cost_gbp: money(fixed_monthly_cost),
        sms_estimated_segment_cost_gbp: money(segment_cost),
        # How many settled texts that rate was measured from, or nil when it is the configured
        # figure. Two very different claims, and the page has to be able to tell them apart.
        sms_estimated_segment_cost_from_settled: estimate.settled_rows,
        houses_with_spend: houses.length,
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
      ApplicationRecord.connection.select_all(bind(sql), name).each(&)
    end

    def bind(sql)
      ApplicationRecord.sanitize_sql_array(
        [ sql, { starts_at: window.starts_at, ends_at: window.ends_at,
                 assumed_segments: ASSUMED_SEGMENTS, currency: CURRENCY,
                 settled_since: window.ends_at - SETTLED_SAMPLE_DAYS.days } ]
      )
    end

    # The measured per-segment rate, or nil when there is not enough settled evidence to claim one.
    # Zero segments cannot be divided by, and would only arise from a sample of rows that are all
    # priced and all somehow segmentless.
    def measured_estimate
      row = ApplicationRecord.connection.select_one(bind(SETTLED_RATE_SQL), "SuperAdmin::Spend rate")
      return nil if row.nil?

      rows = integer(row["settled_rows"])
      segments = integer(row["segments"])
      return nil if rows < SETTLED_SAMPLE_MINIMUM || segments.zero?

      Estimate.new(rate: decimal(row["price"]) / segments, settled_rows: rows)
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
        # Only pounds reach the headline figure. Anything else is carried beside it, unconverted.
        sms_cost_settled: unit == CURRENCY ? settled : BigDecimal(0),
        texts_estimated: integer(row["texts_estimated"]),
        texts_unpriceable: integer(row["texts_unpriceable"]),
        estimated_segments: integer(row["estimated_segments"]),
        other_currencies: unit == CURRENCY || settled.zero? ? {} : { unit => settled }
      )
    end

    def ai_bucket(row)
      ZERO_BUCKET.merge(
        claude_calls: integer(row["claude_calls"]),
        claude_tokens_in: integer(row["claude_tokens_in"]),
        claude_tokens_out: integer(row["claude_tokens_out"]),
        claude_cost_usd: decimal(row["claude_cost_usd"]),
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
        total_per_active_member: money(per_member),
        # Its own field, never folded into `total`: it is an allocation, not a charge this house
        # incurred, and the two must not be mistaken for each other.
        allocated_fixed_cost: money(allocated)
      )
    end

    # --- figures ----------------------------------------------------------------------------------

    # `texts_sent` and `segments` count what Twilio accepted and billed for — the population the
    # cost figures below are drawn from — not what a handset received. On a page about money those
    # have to be the same set, or the cost per text is divided by a denominator that excludes texts
    # it was charged for. `texts_settled` + `texts_estimated` + `texts_unpriceable` = `texts_sent`.
    def figures(bucket)
      estimated = estimated_cost(bucket)

      {
        texts_sent: bucket[:texts_sent],
        segments: bucket[:segments],
        texts_settled: bucket[:texts_settled],
        sms_cost_settled: money(bucket[:sms_cost_settled]),
        texts_estimated: bucket[:texts_estimated],
        texts_unpriceable: bucket[:texts_unpriceable],
        sms_cost_estimated: money(estimated),
        sms_cost: money(bucket[:sms_cost_settled] + estimated),
        sms_cost_other_currencies: other_currencies(bucket),
        claude_calls: bucket[:claude_calls],
        claude_tokens_in: bucket[:claude_tokens_in],
        claude_tokens_out: bucket[:claude_tokens_out],
        # Two figures for one bill, and both are always here. `claude_usd` is what Anthropic
        # charged, in the currency it charged in; `claude_cost` is that in pounds, or NIL when no
        # rate is configured. Nil and not zero: a zero in this column would read as "Claude was
        # free", which is the most expensive lie this page can tell, and it would add to the
        # totals as if it were a fact.
        claude_usd: money(bucket[:claude_cost_usd]),
        claude_cost: money(claude_gbp(bucket)),
        claude_calls_unpriced: bucket[:claude_calls_unpriced],
        titles_classified: bucket[:titles_classified],
        total: money(total_of(bucket))
      }
    end

    # Anthropic's bill in this page's currency, or nil when nobody has set a rate. The one
    # conversion on the page, applied to the one vendor that bills in dollars. See the class note.
    def claude_gbp(bucket)
      return nil if claude_unconverted?

      bucket[:claude_cost_usd] * gbp_per_usd
    end

    def estimated_cost(bucket)
      segment_cost * bucket[:estimated_segments]
    end

    # Everything this page can state in pounds. Claude joins it only once there is a rate to state
    # it with — `claude_unconverted` is how the payload says the total is short by that much, so a
    # reader is never left to infer it from a figure that looks complete.
    def total_of(bucket)
      bucket[:sms_cost_settled] + estimated_cost(bucket) + (claude_gbp(bucket) || BigDecimal(0))
    end

    # Charges this page refuses to convert: Twilio billed them in something other than pounds and
    # Twilio's rate for that destination is not a fact we hold. SPEND_GBP_PER_USD is Anthropic's
    # rate, and borrowing it for a Twilio charge would be a different guess wearing a real number.
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
      # Nil, like every other figure here that has no answer: with no rate there is no pound cost
      # per title, and a dollar one in a column of pounds would be worse than none.
      claude = claude_gbp(total)
      # Houses with nobody left to text are not in the per-member spread at all. They would have to
      # be divided by zero to join it, and dropping them is the only reading that is not a lie.
      housed = houses.select { |house| house[:active_members].positive? }

      {
        cost_per_house_per_month: percentiles(houses.map { |house| house[:total] / window.months }),
        cost_per_active_member_per_month: percentiles(
          housed.map { |house| house[:total] / house[:active_members] / window.months }
        ),
        cost_per_text_sent: money(texts.positive? ? sms / texts : nil),
        cost_per_title_classified: money(claude && titles.positive? ? claude / titles : nil),
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
      PERCENTILES.transform_values { |percent| money(percentile(sorted, percent)) }
    end

    def percentile(sorted, percent)
      return nil if sorted.empty?

      rank = (BigDecimal(percent) * sorted.length / 100).ceil
      sorted[[ rank, 1 ].max - 1]
    end

    # --- coercion and serialisation ---------------------------------------------------------------

    # Money, as a JSON number. BigDecimal serialises as a *string* through Rails' encoder, and a
    # client that has to parse its numbers back out of strings ends up doing Float arithmetic
    # anyway — so the conversion happens once, here, after every sum is final.
    #
    # One method for totals and per-unit prices both. There were two, at different precisions, and
    # that was a way for a per-house total and the cost per text it implies to round to two
    # different truths.
    def money(value)
      value.nil? ? nil : value.round(MONEY_PRECISION).to_f
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
