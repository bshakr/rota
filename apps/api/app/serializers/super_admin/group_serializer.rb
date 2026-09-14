module SuperAdmin
  # One house as the operator sees it: the row on the groups list, and the header of the group page.
  #
  # A separate class from the house-facing GroupSerializer rather than a flag on it, for the same
  # reason every serializer in this namespace is: the two audiences are not the same, and a
  # serializer that can be asked for either shape is one argument away from handing out the wrong
  # one. This one carries counts and a status the house never sees; that one carries the house's
  # own calendar card, which this one has no column for.
  #
  # That is a statement about THIS class, not about the whole operator payload. Since BLO-1679 the
  # group page also carries `report.warnings_input.group`, which IS the house's own serializer, so
  # the operator does see the calendar's STATE — `failing`, `last_error`, `masked_url`, the counts
  # — because that is what one of the five dashboard warnings is made of and the operator is
  # promised the same warnings the house admin gets. The credential is a different matter and is
  # never anywhere near either payload: `ical_url` leaves the server masked or not at all
  # (CalendarConnectionSerializer), for the same reason a member's `access_token` does not.
  #
  # The counts are not read off the record — they come from SuperAdmin::GroupStats, computed once
  # for the whole page, which is why `one` and `many` take it rather than finding it themselves.
  class GroupSerializer < ApplicationSerializer
    def self.many(groups, stats:, now: Time.current)
      groups.map { |group| new(group, stats: stats.for(group), now: now).as_json }
    end

    def self.one(group, stats:, now: Time.current)
      group && new(group, stats: stats.for(group), now: now).as_json
    end

    def initialize(record, stats:, now: Time.current)
      super(record)
      @stats = stats
      @now = now
    end

    def as_json
      {
        id: record.id,
        name: record.name,
        slug: record.slug,
        timezone: record.timezone,
        # NULL `timezone_confirmed_at` means the system guessed UTC on JIT provisioning and no
        # human has ever confirmed it — the house is being texted on a clock nobody chose. It is a
        # filter on this list for exactly that reason.
        timezone_confirmed: record.timezone_confirmed?,
        timezone_confirmed_at: record.timezone_confirmed_at,
        created_at: record.created_at,
        status: GroupStatus.of(record, stats, now: now),
        admins_count: stats.admins,
        active_members_count: stats.active_members,
        running_rotas_count: stats.running_rotas,
        # Staffed but switched off. Its own column because it is neither a draft nor a rota that is
        # texting anyone, and folding it into either would misreport whether reminders go out.
        paused_rotas_count: stats.paused_rotas,
        draft_rotas_count: stats.draft_rotas,
        # Texts the house actually tried to send in the window, and the two ways that goes wrong:
        # Twilio refused it, or SendSmsJob never finished with it. A stranded send is invisible in
        # a single total, and a stuck queue is exactly what this list exists to surface.
        texts_last_7_days: stats.texts,
        unsent_texts_last_7_days: stats.unsent_texts,
        failed_texts_last_7_days: stats.failed_texts,
        last_activity_at: stats.last_activity_at
      }
    end

    private

    attr_reader :stats, :now
  end
end
