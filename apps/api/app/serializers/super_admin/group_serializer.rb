module SuperAdmin
  # One house as the operator sees it: the row on the groups list, and the header of the group page.
  #
  # A separate class from the house-facing GroupSerializer rather than a flag on it, for the same
  # reason every serializer in this namespace is: the two audiences are not the same, and a
  # serializer that can be asked for either shape is one argument away from handing out the wrong
  # one. This one carries counts and a status the house never sees; that one carries the house's
  # own calendar link, which is none of the operator's business.
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

    # One house counted for itself, for the endpoints that act on a single group and have no page of
    # them to share a GroupStats with: PATCH, suspend and resume. It exists so those three answer the
    # same shape the list and the detail answer, and the web merges one row into what it is already
    # showing rather than learning a second shape per action.
    def self.solo(group, now: Time.current)
      one(group, stats: GroupStats.new([ group ], now: now), now: now)
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
        # NULL means live. The moment rather than a boolean, because "paused since when" is the
        # first thing asked about a paused house, and the status pill below already carries the
        # boolean answer.
        suspended_at: record.suspended_at,
        # Operator-only, and structurally so: this is the only serializer in the app that says the
        # word. spec/requests/api/house_payloads_spec.rb holds the house side of that line.
        notes: record.notes,
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
