module SuperAdmin
  # One house as the operator needs to see it: the alerts its own admins are looking at, what is
  # coming up, whether it is still being used, who runs it and who is in it.
  #
  # The second query object in `app/queries/super_admin` (after SuperAdmin::Overview) and the same
  # kind of thing: it reads across a boundary the house side cannot, it writes nothing, and it is
  # reached only from a controller that has already checked the allowlist. Where Overview answers
  # "is anything wrong anywhere", this answers "what is going on in THIS house" — the plan's
  # Group dashboard surface.
  #
  # It rides on GET /api/super_admin/groups/:id under a `report` key rather than on a route of its
  # own. One screen, one request: the header, the tables and this all arrive together, so the page
  # cannot render half a house while the other half is still in flight.
  #
  # NOT CACHED, deliberately, and the one place in this namespace that says so. Overview is cached
  # for sixty seconds because it is a global rollup nobody acts on directly. This is one house, and
  # it is the screen an operator lands on straight after doing something to that house — suspending
  # it, fixing a timezone, chasing a failed text. A minute of staleness there reads as "the action
  # did nothing", which is the one thing an operator must never have to wonder about.
  #
  # Bounded queries: everything below is a grouped or preloaded read, so the count is the same for
  # a house with three members and one with three hundred. spec/queries/super_admin/
  # group_report_spec.rb asserts exactly that, because "no N+1" is a claim that rots silently — and
  # it asserts it against this class rather than through the endpoint on purpose, because the
  # per-request query cache makes a preload that happens to repeat an earlier bind look free, which
  # is not the same thing as it not having run.
  #
  # Every clock question is answered from the `now:` this was given, and never from `Time.current`.
  # The weekly buckets and the fortnight window have to agree with each other; a payload with two
  # clocks in it is one that can straddle a boundary and contradict itself.
  class GroupReport
    # The upcoming window, in the house's OWN calendar days: today plus the next thirteen. Today is
    # included because a turn due this evening is the most actionable row on the page, and the day
    # boundary is the group's midnight — never `Date.current`, which is UTC here and would put a
    # house in Auckland a day ahead of its own rota and one in Honolulu a day behind it. See
    # `upcoming_window` below, and Group#today for why that is not a rounding error.
    UPCOMING_DAYS = 14

    # Twelve weeks of sparkline (plan, Group dashboard: "texts per week and covers per week for the
    # last 12 weeks"). Long enough to show a house's rhythm and whether it is fading, short enough
    # that a quiet fortnight still reads as a dip rather than a rounding error.
    WEEKS = 12

    # The second sign-in figure: "are they still using it", against the all-time "did they ever".
    SIGN_IN_WINDOW = 30.days

    # A cover happening, as recorded. There is no "covered_at" anywhere — a cover is an edit to a
    # shift row, which keeps no history — so the cover NOTICE is the event, exactly as the plan says
    # ("A cover_notice is a cover happening") and exactly as SuperAdmin::Overview's `covers_this_week`
    # counts it. Every status counts: the swap happened whatever became of the text about it.
    COVER_NOTICE = SmsMessage::KINDS.fetch(:cover_notice)

    def self.call(group, now: Time.current) = new(group, now: now).call

    def initialize(group, now: Time.current)
      # One clock for the whole payload, like Overview's. Read twice, the weekly series and the
      # thirty-day sign-in count could straddle a boundary and disagree about what week it is.
      @group = group
      @now = now
    end

    def call
      {
        warnings_input: WarningsInput.call(group),
        upcoming_shifts: upcoming_shifts,
        weekly: weekly,
        admins: admins,
        members: members,
        # Texts and Claude for this house, per month, plus cost per active member.
        # https://linear.app/bloombase/issue/BLO-1684 fills this in from SuperAdmin::Spend once
        # https://linear.app/bloombase/issue/BLO-1683 lands it. Present and null so the page can
        # render the tile's empty state now rather than growing a key later — the same shape, and
        # the same reason, as SuperAdmin::Overview's `spend`.
        spend: nil
      }
    end

    private

    attr_reader :group, :now

    # ---- Upcoming shifts -------------------------------------------------------------------

    # The next fortnight of turns, covers marked. Shaped like the house's own ShiftSerializer —
    # `assigned_member`, `covering_member` and the resolved `responsible_member` — because that is
    # the precedence the reminder job, the calendar and the member page all use, and a console that
    # re-derived it would eventually disagree with who actually gets texted. `rota_name` is carried
    # too: the operator has no rota picker to read it off.
    def upcoming_shifts
      group.shifts
        .where(due_on: upcoming_window)
        # The rota's roster comes with it: `Rota#draft?` is "nobody is on it", asked of the
        # positions, and a row at a time that would be one query per shift.
        .includes(:assigned_member, :covering_member, rota: :rota_positions)
        .to_a
        # Sorted here rather than in SQL: ordering by the rota's name needs a join that would undo
        # the preload, and a fortnight of one house's shifts is a few dozen rows.
        .sort_by { |shift| [ shift.due_on, shift.rota.name.downcase, shift.id ] }
        .map { |shift| upcoming_shift(shift) }
    end

    # The house's own fortnight, on the house's own clock and on the ONE instant this report was
    # given. Deliberately not `Group#today`, which would be a third clock in a payload that already
    # has `@now`: it reads `Time.current` for itself, so a report built for a moment in the past
    # would date its window from now instead and disagree with its own weekly series. The rule that
    # method carries is the part that matters, and it is reproduced exactly — the day boundary is
    # the group's midnight, never the server's. See Group#today for why that is not a rounding error.
    def upcoming_window
      today = now.in_time_zone(group.time_zone).to_date

      today..(today + UPCOMING_DAYS - 1)
    end

    def upcoming_shift(shift)
      rota = shift.rota

      {
        id: shift.id,
        rota_id: shift.rota_id,
        rota_name: rota.name,
        # Whether anybody will actually be told about this turn. A shift on a PAUSED rota is a real
        # row with a real person's name on it and the house's own list shows it, but the reminder
        # sweep only visits active rotas, so nothing will go out for it. An operator answering "why
        # did nobody hear about Thursday" has to be able to see that on the row rather than by
        # cross-referencing the rotas table further down the page. Marked, never filtered out:
        # hiding the turn would answer the question by deleting it.
        rota_active: rota.active,
        rota_draft: rota.draft?,
        due_on: shift.due_on,
        covered: shift.covered?,
        # Who is on the hook by the rota, and who actually took it. Both, so the page can say
        # "Alice (covered by Bob)" — a cover is the product's one real engagement signal and
        # collapsing it to one name would erase it from the screen that exists to see it.
        assigned_member: member_ref(shift.assigned_member),
        covering_member: member_ref(shift.covering_member),
        responsible_member: member_ref(shift.responsible_member)
      }
    end

    def member_ref(member)
      return if member.nil?

      { id: member.id, name: member.name }
    end

    # ---- Weekly series ---------------------------------------------------------------------

    # Texts and covers per week for the last twelve weeks, oldest first, zero-filled.
    #
    # Buckets are MONDAY 00:00 UTC, matching SuperAdmin::Overview's `week_start`
    # (`now.beginning_of_week`, and the server thinks in UTC — config.time_zone). Deliberately the
    # operator's week and not this house's: the operator reads a group page beside the overview and
    # the traffic page, and three screens that each drew their own week boundary would put the same
    # text in a different column on each. It also makes the buckets immune to a clocks change —
    # UTC has none — so the week either side of a DST change is still exactly seven days wide.
    #
    # Zero-filled from the bucket list rather than from what the query returned, so a house that
    # sent nothing for a month draws a flat line rather than a shorter sparkline. Oldest first,
    # because that is the direction a chart is drawn in.
    def weekly
      counted = weekly_counts

      texts = Hash.new(0)
      covers = Hash.new(0)

      counted.each do |(bucket, kind, status), count|
        week = to_week_start(bucket)
        # "Texts" means what GroupStats means by it on the list and on this page's own header —
        # Twilio was asked and either took it or refused it. Rows still pending or sending are not
        # texts that went out, and counting them would draw a spike on a morning when the queue
        # stranded every reminder.
        texts[week] += count if GroupStats::ATTEMPTED_STATUSES.include?(status)
        covers[week] += count if kind == COVER_NOTICE
      end

      week_starts.map do |week|
        { week_start: week, texts: texts[week], covers: covers[week] }
      end
    end

    # One grouped pass for both series. Twelve weeks of a busy house is thousands of rows and this
    # brings back at most a few dozen: one per (week, kind, status) combination that actually exists.
    def weekly_counts
      SmsMessage.joins(:member)
        .where(members: { group_id: group.id }, created_at: weekly_range)
        .group(Arel.sql("date_trunc('week', sms_messages.created_at)::date"), :kind, :status)
        .count
    end

    # Postgres' `date_trunc('week', ...)` is ISO — Monday — and the connection's time zone is UTC
    # (Active Record sets it because config.active_record.default_timezone is :utc), so the bucket
    # boundary is Monday 00:00 UTC, which is what `week_starts` below generates in Ruby.
    def weekly_range
      week_starts.first.in_time_zone...(week_starts.last + 1.week).in_time_zone
    end

    # The twelve Mondays, oldest first, ending with the one the clock is currently inside.
    # `Date#beginning_of_week` is Monday (Active Support's default, and the app never changes it),
    # which is the same boundary `SuperAdmin::Overview#week_start` uses.
    def week_starts
      @week_starts ||= begin
        current = now.utc.to_date.beginning_of_week

        (0...WEEKS).map { |index| current - (WEEKS - 1 - index).weeks }
      end
    end

    # A raw SQL group key has no column to be typecast through, so what comes back for
    # `date_trunc(...)::date` depends on the adapter rather than on a declared type. Normalised in
    # one place instead of being trusted: a String key would quietly miss every bucket and draw
    # twelve zeroes.
    def to_week_start(value)
      case value
      when Date, Time then value.to_date
      else Date.parse(value.to_s)
      end
    end

    # ---- People ----------------------------------------------------------------------------

    # Who runs the house. Identity comes from SuperAdmin::AdminSerializer rather than being rebuilt
    # here — in particular the placeholder-email rule, which is the serializer's job and must have
    # exactly one owner: WorkOS sends no email unless the JWT template was configured to, so an
    # address at `users.workos.invalid` is served as null and rendered "not provided" rather than as
    # something that looks deliverable. This adds only what the serializer has no way to know.
    def admins
      memberships = group.group_admins.includes(:user).order(:id).to_a
      user_ids = memberships.map(&:user_id)

      all_time = sign_in_counts(user_ids)
      recent = sign_in_counts(user_ids, since: now - SIGN_IN_WINDOW)

      memberships.map do |membership|
        AdminSerializer.one(membership).merge(
          # Throttled to one write an hour on the read path (LastSeen), so this is accurate to the
          # hour, which is the resolution "last seen" is read at anyway.
          last_seen_at: membership.user.last_seen_at,
          # `user_` and not `admin_`, because these are facts about the PERSON and not about this
          # membership — see `sign_in_counts` below. A key named `sign_in_count` on a row that is
          # otherwise all about one house would read as "signed in to this house", which is exactly
          # what it is not.
          user_sign_in_count: all_time.fetch(membership.user_id, 0),
          user_sign_in_count_30d: recent.fetch(membership.user_id, 0)
        )
      end
    end

    # The PERSON's sign-ins, every organization and none — not this house's. Hence the `user_`
    # prefix on both keys: they are the only figures on an admin's row that are not about this
    # house, and a reader must not have to know that from a comment.
    #
    # Two reasons for counting them that way. A sign-in that names no organization is the funnel
    # step the `sign_ins` table was added for (somebody signed in and has no house yet), and
    # filtering by organization would drop exactly those rows. And the question a group page asks of
    # an admin is "is this person still using Rota Monster", which is answered by their sign-ins
    # wherever they landed. An admin of two houses therefore shows the same count on both pages, on
    # purpose.
    def sign_in_counts(user_ids, since: nil)
      return {} if user_ids.empty?

      scope = SignIn.where(user_id: user_ids)
      scope = scope.where(created_at: since..) if since
      scope.group(:user_id).count
    end

    # Everyone in the house, active or not, with the rotas they sit on. The row is
    # SuperAdmin::MemberSerializer's — phone in full, no access token, ever — plus the one column it
    # does not carry: when this person last opened their magic link, which is the only evidence the
    # product has that the link ever arrived.
    def members
      group.members.includes(:rotas).order(:name).map do |member|
        MemberSerializer.one(member).merge(last_seen_at: member.last_seen_at)
      end
    end
  end
end
