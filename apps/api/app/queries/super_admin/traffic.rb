module SuperAdmin
  # Is the product converting, and is it doing anything for the houses that made it through?
  #
  # Two halves, exactly as the plan's Traffic dashboard describes them. A conversion FUNNEL, with a
  # rate from each step to the next and two figures beside it — how long a house takes to send its
  # first text, and how many people signed in and never made a house at all. And a weekly SERIES of
  # what actually happened: texts by kind, whether they arrived, what the failures said, covers,
  # and who was around.
  #
  # A query object on the convention SuperAdmin::Overview set out: app/queries is for reads across
  # every tenant that change nothing, and app/services stays for the things that change one house.
  # Nothing in this file writes, and the request spec holds that line.
  #
  # Deliberately unscoped, like everything under SuperAdmin::. Reading across every house is the
  # point of the surface, which is exactly why it lives beside `TenantScoped` rather than inside it
  # — see SuperAdmin::BaseController. The only parameter it takes is a range key checked against a
  # fixed list before anything is read, so there is no id here for a house admin to smuggle across
  # the boundary: the allowlist is the only gate, and it runs first.
  #
  # Live SQL, cached for a minute (plan, "Aggregation"). Every read below is grouped in the
  # database and folded in Ruby, so the number of round trips is the same for three houses as for
  # three hundred — spec/queries/super_admin/traffic_spec.rb asserts that rather than trusting it.
  class Traffic
    # A range the caller made up. Raised from the constructor so the controller can answer 400
    # before anything is computed or cached.
    class UnknownRange < ArgumentError; end

    Window = Data.define(:key, :starts_at, :ends_at) do
      # Inclusive at both ends: a row stamped exactly on a boundary is counted once, in this window.
      def range = starts_at..ends_at
    end

    # The three windows the page offers. Each is an exact number of days ending now, measured
    # against the operator's UTC clock rather than any one house's — a cross-house figure cannot be
    # in thirty local midnights at once.
    RANGE_DAYS = { "7d" => 7, "30d" => 30, "90d" => 90 }.freeze
    RANGES = RANGE_DAYS.keys.freeze
    DEFAULT_RANGE = "30d"

    # Versioned because Solid Cache survives a deploy. Without the suffix, the sixty seconds after
    # shipping a change to this payload would serve the OLD shape to the NEW page, which is a
    # confusing way to break a dashboard. Bump it whenever the payload changes — its shape OR its
    # values (a step that starts counting something different is the case worth naming, because the
    # old entry stays perfectly parseable and is simply wrong).
    CACHE_KEY = "super_admin/traffic/v1".freeze
    CACHE_TTL = 60.seconds

    # The plan's eight steps, in order, as [ key, unit ].
    #
    # Steps 3 to 8 carry the same names SuperAdmin::Overview gives the rungs of its onboarding
    # ladder, on purpose: the overview's "furthest step" for one house and this funnel's counts
    # across all of them are the same ladder counted two ways, and two names for one rung would be
    # a bug waiting to be argued about.
    #
    # The unit changes at step 3, and that is the plan's funnel rather than a slip: step 2 counts
    # PEOPLE who signed in, and everything below it counts HOUSES. The page says so on each bar.
    STEPS = [
      [ "landing_views", "views" ],
      [ "signed_in", "users" ],
      [ "made_house", "houses" ],
      [ "confirmed_timezone", "houses" ],
      [ "added_member", "houses" ],
      [ "started_rota", "houses" ],
      [ "delivered_text", "houses" ],
      [ "first_cover", "houses" ]
    ].freeze

    # Step 1 needs the `page_views` table that is Phase 6
    # (https://linear.app/bloombase/issue/BLO-1668's last phase), and anonymous landing traffic
    # cannot be backfilled. So the step is published with a null count and this note rather than a
    # zero: "nobody visited" and "nobody counted" are opposite facts and must not render alike.
    UNTRACKED_NOTE = "not tracked yet".freeze

    # Enough to see the shape of a delivery problem without turning the page into a Twilio manual.
    FAILURE_CODES_SHOWN = 5

    # Every kind, from the model's own constant, so a fourth kind of text cannot silently fall out
    # of the stacked bars.
    KINDS = SmsMessage::KINDS.values.map(&:to_sym).freeze

    # --- SQL ------------------------------------------------------------------------------------
    #
    # Raw, because every read here is a grouped roll-up and Active Record's grouping would say the
    # same thing at twice the length. Bound through `sanitize_sql_array` with named parameters; no
    # value below is ever interpolated into a string.
    #
    # DATE_TRUNC('week', …) is the one function this file leans on. The timestamp columns are
    # `timestamp without time zone` holding UTC, and Postgres truncates an ISO week to Monday
    # 00:00, so every bucket edge here is Monday midnight UTC — the same week SuperAdmin::Overview
    # means by `beginning_of_week`, and stable across a clocks change because nothing in it is
    # local time. The spec proves that across both of Europe/London's 2026 transitions.

    # Steps 5 to 8, in one query: the number of houses whose FIRST such event falls inside the
    # window.
    #
    # Cohort, not "any". The plan asks for "a funnel of counts within the range, each with its rate
    # from the previous step", and a rate only means anything if each step counts houses arriving at
    # it. Counting every house that added a member in the window would put a two-year-old house that
    # replaced a housemate into the same bar as a brand new one, and the rate from "made a house"
    # would wander above 100% for reasons that have nothing to do with conversion. So each subquery
    # takes the house's earliest event over ALL of time and then asks whether that moment lands in
    # the window.
    #
    # Three steps sit outside that cohort, each for its own reason. Step 3 is the same idea read off
    # a column: a house is created once, so its `created_at` is the event and the first of it. Step 4
    # is NOT a cohort — `timezone_confirmed_at` is re-stamped every time an admin saves the house
    # settings with a timezone in the request (Api::GroupController#update: sending the param IS the
    # confirmation, even when the value has not moved), so a two-year-old house that opened its
    # settings page this morning walks straight into step 4's bar. Counting genuinely first
    # confirmations needs a column nothing writes today, so this step counts confirmations inside the
    # window and must be read that way. And step 2 is deliberately not a cohort either: distinct
    # users with a sign-in in the window, which is the "who turned up" figure the plan's own wording
    # asks for and the denominator the steps below it are rated against.
    FUNNEL_SQL = <<~SQL.freeze
      SELECT 'added_member' AS step, COUNT(*) AS count FROM (
        SELECT members.group_id
        FROM members
        GROUP BY members.group_id
        HAVING MIN(members.created_at) >= :starts_at AND MIN(members.created_at) <= :ends_at
      ) AS first_member
      UNION ALL
      SELECT 'started_rota', COUNT(*) FROM (
        SELECT rotas.group_id
        FROM rota_positions
        INNER JOIN rotas ON rotas.id = rota_positions.rota_id
        GROUP BY rotas.group_id
        HAVING MIN(rota_positions.created_at) >= :starts_at
           AND MIN(rota_positions.created_at) <= :ends_at
      ) AS first_roster
      UNION ALL
      SELECT 'delivered_text', COUNT(*) FROM (
        SELECT members.group_id
        FROM sms_messages
        INNER JOIN members ON members.id = sms_messages.member_id
        WHERE sms_messages.kind = 'reminder' AND sms_messages.status = 'delivered'
        GROUP BY members.group_id
        HAVING MIN(sms_messages.created_at) >= :starts_at
           AND MIN(sms_messages.created_at) <= :ends_at
      ) AS first_delivered
      UNION ALL
      SELECT 'first_cover', COUNT(*) FROM (
        SELECT members.group_id
        FROM sms_messages
        INNER JOIN members ON members.id = sms_messages.member_id
        WHERE sms_messages.kind = 'cover_notice'
        GROUP BY members.group_id
        HAVING MIN(sms_messages.created_at) >= :starts_at
           AND MIN(sms_messages.created_at) <= :ends_at
      ) AS first_cover
    SQL

    # One row per admin whose first sign-in AND whose house's first delivered reminder both fall
    # inside the window: the hours between the two. The median is taken in Ruby, off however few
    # rows this returns.
    #
    # Both ends inside the window on purpose. This is a figure about the window — "for the houses
    # that started here, how long did the product take" — and letting either end wander outside it
    # would mix a January onboarding into a March median. The cost is that a short range reports on
    # few houses, or none, which is why the sample size is published beside the figure.
    #
    # It is also survivorship-biased towards the fast, structurally and unavoidably: a house can only
    # appear here once it has actually sent its first text, so the houses still stuck in onboarding
    # at the trailing edge of the window are missing from the median rather than dragging it up. The
    # shorter the range the worse that gets — a 7d median is close to meaningless, because only the
    # houses that converted inside a week can be in it at all.
    #
    # Three more deliberate choices. The sign-in is the admin's FIRST ever, so signing in again
    # tomorrow does not restart their clock. An admin who sits in two houses is measured to
    # whichever house texted first, because that is the moment the product worked for them. And a
    # house that was already delivering before this admin ever signed in is excluded outright — the
    # second admin of an established house is not a measurement of how long the product takes.
    TIME_TO_TEXT_SQL = <<~SQL.freeze
      WITH first_sign_in AS (
        SELECT sign_ins.user_id AS user_id, MIN(sign_ins.created_at) AS at
        FROM sign_ins
        GROUP BY sign_ins.user_id
      ), first_delivered AS (
        SELECT members.group_id AS group_id, MIN(sms_messages.created_at) AS at
        FROM sms_messages
        INNER JOIN members ON members.id = sms_messages.member_id
        WHERE sms_messages.kind = 'reminder' AND sms_messages.status = 'delivered'
        GROUP BY members.group_id
      )
      SELECT EXTRACT(EPOCH FROM (MIN(first_delivered.at) - first_sign_in.at)) / 3600.0 AS hours
      FROM first_sign_in
      INNER JOIN group_admins ON group_admins.user_id = first_sign_in.user_id
      INNER JOIN first_delivered ON first_delivered.group_id = group_admins.group_id
      WHERE first_sign_in.at >= :starts_at
        AND first_sign_in.at <= :ends_at
        AND first_delivered.at >= :starts_at
        AND first_delivered.at <= :ends_at
        AND first_delivered.at >= first_sign_in.at
      GROUP BY first_sign_in.user_id, first_sign_in.at
    SQL

    # The texting week, split by kind, with what became of each pile.
    #
    # `texts_sent` is every row the app created that week, whatever became of it — including the
    # ones that never left, such as a member who had opted out. Filtering those out would make the
    # stacked bars disagree with the failure table directly below them, which reports exactly those
    # rows under `not_contactable`.
    TEXTS_SQL = <<~SQL.freeze
      SELECT
        DATE_TRUNC('week', sms_messages.created_at) AS week_start,
        sms_messages.kind AS kind,
        COUNT(*) AS texts_sent,
        COUNT(*) FILTER (WHERE sms_messages.status = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE sms_messages.status = 'failed') AS failed
      FROM sms_messages
      WHERE sms_messages.created_at >= :starts_at AND sms_messages.created_at <= :ends_at
      GROUP BY 1, 2
    SQL

    # Houses that heard from us in the week. Its own query rather than a column on the one above,
    # because a distinct count cannot be added up across the kinds: a house that got a reminder and
    # a cover notice in one week is one active house, not two.
    #
    # Delivered, not sent — the plan's definition. A house whose every text bounces is not a house
    # the product is serving.
    ACTIVE_HOUSES_SQL = <<~SQL.freeze
      SELECT
        DATE_TRUNC('week', sms_messages.created_at) AS week_start,
        COUNT(DISTINCT members.group_id) AS active_houses
      FROM sms_messages
      INNER JOIN members ON members.id = sms_messages.member_id
      WHERE sms_messages.status = 'delivered'
        AND sms_messages.created_at >= :starts_at
        AND sms_messages.created_at <= :ends_at
      GROUP BY 1
    SQL

    # Signed-in people who were around in the week: a sign-in OR a `last_seen_at` inside it, counted
    # once.
    #
    # Users, not admins, and the payload says `active_users` for that reason. Every row in `users` is
    # somebody who signed in, whether or not they ever made a house, so this number and
    # `signed_in_without_house` deliberately overlap: a person who signs in every day and never makes
    # a house is active here AND a leak there. Narrowing this to people with a `group_admins` row
    # would make the series quietly disagree with the funnel above it about who exists.
    #
    # Two signals because each is blind on its own. `sign_ins` is the history, but an admin who
    # stays signed in for a month signs in once; `users.last_seen_at` is the throttled touch from
    # the authenticated read path, but it is a single moving column, so it can only ever light up
    # the most recent week a person was seen. Together they answer "was this person using the
    # product that week" better than either does alone.
    ACTIVE_USERS_SQL = <<~SQL.freeze
      SELECT week_start, COUNT(DISTINCT user_id) AS active_users
      FROM (
        SELECT DATE_TRUNC('week', sign_ins.created_at) AS week_start, sign_ins.user_id AS user_id
        FROM sign_ins
        WHERE sign_ins.created_at >= :starts_at AND sign_ins.created_at <= :ends_at
        UNION ALL
        SELECT DATE_TRUNC('week', users.last_seen_at), users.id
        FROM users
        WHERE users.last_seen_at >= :starts_at AND users.last_seen_at <= :ends_at
      ) AS seen
      GROUP BY week_start
    SQL

    # The two weekly counts that are plain counts, in one round trip. `members_last_seen` is
    # housemates who opened their magic link — the only signal that the link ever arrived — and
    # `new_houses` is the top of the funnel drawn week by week.
    #
    # `members.last_seen_at` carries the same caveat as `users.last_seen_at` above, and it is worse
    # here because there is no second signal to make up for it: members have no `sign_ins` table. It
    # is one moving column, so each member can only ever light up the week they were LAST seen. A
    # housemate who has opened their link every week for a year appears once, in this week. The
    # series therefore rises towards the present by construction — it is "members most recently seen
    # in this week", never "members who opened their link that week" — which is why the payload key
    # says `members_last_seen` and why the page must label it that way.
    COUNTS_SQL = <<~SQL.freeze
      SELECT 'members_last_seen' AS series,
             DATE_TRUNC('week', members.last_seen_at) AS week_start,
             COUNT(*) AS count
      FROM members
      WHERE members.last_seen_at >= :starts_at AND members.last_seen_at <= :ends_at
      GROUP BY 1, 2
      UNION ALL
      SELECT 'new_houses',
             DATE_TRUNC('week', groups.created_at),
             COUNT(*)
      FROM groups
      WHERE groups.created_at >= :starts_at AND groups.created_at <= :ends_at
      GROUP BY 1, 2
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

      def window_for(range)
        key = range.presence || DEFAULT_RANGE

        unless RANGE_DAYS.key?(key)
          # The caller's own value is echoed back only when it is a string, which is all a query
          # parameter can be. Anything else reached this method from code rather than from a URL, and
          # inspecting it would put whatever it was — a hash of parameters, say — into an error
          # message that the web app shows and the logs keep.
          named = key.is_a?(String) ? key.inspect : "unrecognised"
          raise UnknownRange, "#{named} is not a known range (#{RANGES.join(', ')})"
        end

        ends_at = Time.current

        Window.new(key: key, starts_at: ends_at - RANGE_DAYS.fetch(key).days, ends_at: ends_at)
      end
    end

    attr_reader :window

    def initialize(range: nil)
      # Raises before anything is read or cached, so a bad range costs one comparison.
      @window = self.class.window_for(range)
    end

    # The key is the range and nothing else. Every operator sees the same numbers, so one cached
    # copy serves all of them; a per-user key would mean a per-user minute of staleness and N copies
    # of an identical payload.
    def cached
      Rails.cache.fetch(self.class.cache_key(window.key), expires_in: CACHE_TTL) { call }
    end

    def call
      counts = step_counts

      {
        range: window.key,
        starts_at: window.starts_at.iso8601,
        ends_at: window.ends_at.iso8601,
        generated_at: Time.current.iso8601,
        funnel: funnel(counts),
        # Beside the funnel, both of them the questions a bar chart cannot answer: how long the
        # product takes to do anything for a house, and how many people it lost before it got the
        # chance.
        median_hours_to_first_text: median(hours_to_first_text),
        median_hours_sample: hours_to_first_text.length,
        signed_in_without_house: signed_in_without_house,
        weeks: weeks,
        failures: failures
      }
    end

    private

    # --- the funnel -------------------------------------------------------------------------------

    def funnel(counts)
      previous = nil

      STEPS.each_with_index.map do |(key, unit), index|
        count = counts[key]
        step = {
          step: index + 1,
          key: key,
          unit: unit,
          tracked: !count.nil?,
          count: count,
          rate_from_previous: rate(count, previous),
          note: count.nil? ? UNTRACKED_NOTE : nil
        }
        previous = count
        step
      end
    end

    def step_counts
      cohort = each_row(FUNNEL_SQL, "SuperAdmin::Traffic funnel")
        .to_h { |row| [ row["step"], row["count"].to_i ] }

      {
        # Null, not zero. See UNTRACKED_NOTE.
        "landing_views" => nil,
        "signed_in" => SignIn.where(created_at: window.range).distinct.count(:user_id),
        "made_house" => Group.where(created_at: window.range).count,
        "confirmed_timezone" => Group.where(timezone_confirmed_at: window.range).count
      }.merge(cohort)
    end

    # A step as a share of the one above it, to one decimal — 41.7, never 42 (project rule: a figure
    # never renders coarser than it was computed).
    #
    # Null when there is no denominator: the step above is untracked, or nothing reached it. And
    # deliberately NOT capped at 100. Each step counts arrivals inside one window, so a house made by
    # somebody who signed in last month can carry step 3 above step 2 — which is worth seeing,
    # because it says the window is too short to explain itself, not that the maths is broken.
    #
    # Step 4 is the one that will do it most often, and for a different reason: as the FUNNEL_SQL
    # comment says, `timezone_confirmed_at` is re-stamped on every settings save, so an established
    # house re-confirming its timezone lands in step 4 without ever having been in step 3's count.
    # A rate over 100% there is re-confirmation, not conversion.
    def rate(count, previous)
      return nil if count.nil? || previous.nil? || previous.zero?

      ((count.to_f / previous) * 100).round(1)
    end

    # --- beside the funnel ------------------------------------------------------------------------

    def hours_to_first_text
      @hours_to_first_text ||= each_row(TIME_TO_TEXT_SQL, "SuperAdmin::Traffic time to first text")
        .map { |row| row["hours"].to_f }
    end

    # The textbook median: the middle value, or the midpoint of the two middle ones.
    #
    # SuperAdmin::Spend takes its median by nearest rank instead, and the difference is deliberate.
    # That one quotes the cost of a house, and every figure it prints should be a house that really
    # exists. This one is a duration, where the midpoint of two is the honest answer and picking the
    # lower of them would quietly flatter the product.
    def median(values)
      return nil if values.empty?

      sorted = values.sort
      middle = sorted.length / 2

      hours = sorted.length.odd? ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2.0
      hours.round(1)
    end

    # The leak this dashboard exists to expose: somebody signed in during the window and has no
    # house at all.
    #
    # "Has no house" is read as of NOW, not as of the sign-in. Somebody who signed in on Tuesday and
    # made their house on Wednesday converted, and counting them here for the rest of the window
    # would make the leak look permanently worse than it is.
    def signed_in_without_house
      SignIn.where(created_at: window.range)
        .where.not(user_id: GroupAdmin.select(:user_id))
        .distinct.count(:user_id)
    end

    # --- the weekly series ------------------------------------------------------------------------

    def weeks
      texts = texts_by_week
      active_houses = single_series(ACTIVE_HOUSES_SQL, "SuperAdmin::Traffic active houses", "active_houses")
      active_users = single_series(ACTIVE_USERS_SQL, "SuperAdmin::Traffic active users", "active_users")
      counts = labelled_series(COUNTS_SQL, "SuperAdmin::Traffic weekly counts")

      weeks_in_window.map do |week|
        row = texts.fetch(week, empty_texts)

        {
          week_starting: week.iso8601,
          texts_sent: row[:texts_sent],
          texts_by_kind: row[:by_kind],
          texts_delivered: row[:delivered],
          texts_failed: row[:failed],
          # The rate's denominator, published beside it so the page can say "96.4% of 412 settled"
          # and a reader can tell 96.4% of twelve texts from 96.4% of four hundred.
          texts_settled: row[:delivered] + row[:failed],
          delivery_rate: delivery_rate(row[:delivered], row[:failed]),
          # The same number as `texts_by_kind[:cover_notice]`, surfaced on its own because it is not
          # a texting figure at all: a cover is one housemate taking another's turn, and it is the
          # product's one real engagement signal (plan, Traffic dashboard).
          covers: row[:by_kind][:cover_notice],
          active_houses: active_houses.fetch(week, 0),
          active_users: active_users.fetch(week, 0),
          members_last_seen: counts.dig("members_last_seen", week) || 0,
          new_houses: counts.dig("new_houses", week) || 0
        }
      end
    end

    # Every week the window touches, in order, including the ones nothing happened in: a chart with
    # a hole in it reads as missing data rather than as a quiet week, and an x-axis that changes
    # shape between two ranges cannot be compared with itself.
    #
    # The first bucket is a partial week in all three ranges, because no range is snapped to a
    # Monday. That is the honest shape — the alternative is a chart whose oldest bar claims to be a
    # whole week and is not.
    def weeks_in_window
      first = window.starts_at.to_date.beginning_of_week
      last = window.ends_at.to_date.beginning_of_week

      (first..last).step(7).to_a
    end

    # Delivered as a share of the texts whose fate is settled — delivered plus failed.
    #
    # The denominator deliberately excludes rows still in flight (`pending`, `sending`, and `sent`
    # waiting on a receipt). The sweep lays down a batch of pending rows on the hour, so counting
    # them would drop the rate every hour and recover it minutes later, and an operator cannot tell
    # that kind of sawtooth apart from a real delivery problem. One decimal, never a whole percent.
    #
    # Null, not zero, when nothing has settled: "no texts yet" and "none of them arrived" are
    # opposite facts and must not render as the same bar.
    def delivery_rate(delivered, failed)
      settled = delivered + failed
      return nil if settled.zero?

      ((delivered.to_f / settled) * 100).round(1)
    end

    def texts_by_week
      each_row(TEXTS_SQL, "SuperAdmin::Traffic texts").each_with_object({}) do |row, weeks|
        week = week_of(row["week_start"])
        bucket = weeks[week] ||= empty_texts
        kind = row["kind"].to_sym
        sent = row["texts_sent"].to_i

        bucket[:texts_sent] += sent
        # A kind the model does not know is still a text and still belongs in the total, but it
        # cannot be given a bar of its own without inventing a colour for it.
        bucket[:by_kind][kind] += sent if bucket[:by_kind].key?(kind)
        bucket[:delivered] += row["delivered"].to_i
        bucket[:failed] += row["failed"].to_i
      end
    end

    def empty_texts
      { texts_sent: 0, by_kind: KINDS.index_with(0), delivered: 0, failed: 0 }
    end

    def single_series(sql, name, column)
      each_row(sql, name).to_h { |row| [ week_of(row["week_start"]), row[column].to_i ] }
    end

    def labelled_series(sql, name)
      each_row(sql, name).each_with_object({}) do |row, series|
        (series[row["series"]] ||= {})[week_of(row["week_start"])] = row["count"].to_i
      end
    end

    # --- failures ---------------------------------------------------------------------------------

    # What went wrong, over the whole range rather than week by week: five codes is a diagnosis, and
    # five codes times thirteen weeks is a spreadsheet.
    #
    # `total` counts every failed text in the range, including the ones that carry no code at all,
    # and `uncoded` says how many those were. So the shares are all of one denominator and visibly
    # do not have to add up to a hundred — which is the honest way to publish a top five.
    def failures
      by_code = SmsMessage.failed.where(created_at: window.range).group(:error_code).count
      total = by_code.values.sum
      coded = by_code.except(nil)

      {
        total: total,
        uncoded: by_code[nil].to_i,
        # Worst first, then by code so two codes with the same count never swap places between two
        # reads of the same data.
        top: coded.sort_by { |code, count| [ -count, code.to_s ] }.first(FAILURE_CODES_SHOWN).map do |code, count|
          { error_code: code, count: count, share: share(count, total) }
        end
      }
    end

    def share(count, total)
      return nil if total.zero?

      ((count.to_f / total) * 100).round(1)
    end

    # --- reading ----------------------------------------------------------------------------------

    def each_row(sql, name)
      bound = ApplicationRecord.sanitize_sql_array(
        [ sql, { starts_at: window.starts_at, ends_at: window.ends_at } ]
      )
      ApplicationRecord.connection.select_all(bound, name)
    end

    # DATE_TRUNC hands back the Monday itself; the adapter may have cast it already or may still be
    # holding the string libpq sent.
    def week_of(value)
      value.is_a?(String) ? Date.parse(value) : value.to_date
    end
  end
end
