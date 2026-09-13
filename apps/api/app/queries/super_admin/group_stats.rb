module SuperAdmin
  # Everything the groups list shows about a house that is not a column on `groups`.
  #
  # Every one of those columns — how many admins, how many active members, how many rotas are
  # running and how many are still drafts, how many texts went out this week and how many failed,
  # when anything last happened — is a count over a different table. Asked one row at a time that
  # is five queries per house, and the list is the screen an operator opens first: it is the one
  # that must not get slower as houses are added. So it is asked once for the whole page, grouped
  # by group id, in five queries no matter how many houses come back.
  #
  # Deliberately not `TenantScoped` and deliberately reaching across every house — that is the
  # whole point of the super admin area. See SuperAdmin::BaseController.
  class GroupStats
    # "Texts this week" on the list. A week is what makes a delivery problem visible while it is
    # still happening; a month would bury today's failures under three weeks of healthy sends.
    TEXTS_WINDOW = 7.days

    # One house's row. A Data object rather than a hash so a typo in a key is a NoMethodError at
    # the serializer instead of a silent `nil` rendered as a blank column.
    Row = Data.define(
      :admins, :active_members, :running_rotas, :paused_rotas, :draft_rotas, :texts, :unsent_texts,
      :failed_texts, :last_activity_at
    ) do
      # A house that has no rows in any of the other tables yet — a brand new one, which is
      # exactly the house an operator is most likely to be looking at.
      def self.empty
        new(admins: 0, active_members: 0, running_rotas: 0, paused_rotas: 0, draft_rotas: 0,
          texts: 0, unsent_texts: 0, failed_texts: 0, last_activity_at: nil)
      end

      # Every rota somebody is actually on, whether or not it is switched on right now. This is
      # what "has this house ever started" is asked of, and it is derived rather than stored so it
      # can never disagree with the two counts it is made of: a house that ran for a year and then
      # paused its rotas has not become a house that never began.
      def staffed_rotas = running_rotas + paused_rotas
    end

    # `groups` is an already-loaded array, not a relation: the caller has to hold the same objects
    # it will serialize, and loading the relation twice would be the N+1 this class exists to
    # avoid, one level up.
    def initialize(groups, now: Time.current)
      @group_ids = groups.map(&:id)
      @now = now
    end

    def for(group)
      rows.fetch(group.id, Row.empty)
    end

    private

    attr_reader :group_ids, :now

    def rows
      @rows ||= build_rows
    end

    def build_rows
      return {} if group_ids.empty?

      admins = admin_counts
      members = active_member_counts
      rotas = rota_counts
      texts = text_counts
      activity = last_activity

      group_ids.index_with do |id|
        rota = rotas.fetch(id, { running: 0, paused: 0, draft: 0 })
        text = texts.fetch(id, { attempted: 0, unsent: 0, failed: 0 })

        Row.new(
          admins: admins.fetch(id, 0),
          active_members: members.fetch(id, 0),
          running_rotas: rota.fetch(:running),
          paused_rotas: rota.fetch(:paused),
          draft_rotas: rota.fetch(:draft),
          texts: text.fetch(:attempted),
          unsent_texts: text.fetch(:unsent),
          failed_texts: text.fetch(:failed),
          last_activity_at: activity[id]
        )
      end
    end

    def admin_counts
      GroupAdmin.where(group_id: group_ids).group(:group_id).count
    end

    def active_member_counts
      Member.active.where(group_id: group_ids).group(:group_id).count
    end

    # Running versus draft is decided by the roster, not by a column: `Rota#draft?` is "nobody is
    # on it", and a stored flag could disagree with the roster it claims to describe. So the query
    # asks Postgres for each rota's roster size and the classification happens here, in Ruby,
    # against the same rule the house's own serializer renders. A rota with a roster that has been
    # switched off is neither — it is paused, and counting it as running would tell the operator
    # reminders are going out when they are not.
    def rota_counts
      rosters = Rota.where(group_id: group_ids)
        .left_joins(:rota_positions)
        .group(:group_id, :id, :active)
        .count("rota_positions.id")

      rosters.each_with_object({}) do |((group_id, _rota_id, active), roster_size), counts|
        row = counts[group_id] ||= { running: 0, paused: 0, draft: 0 }

        if roster_size.zero?
          row[:draft] += 1
        elsif active
          row[:running] += 1
        else
          # Staffed but switched off. Its own count rather than being folded into either of the
          # others: it is not a draft (somebody is on it) and it is not running (nobody is being
          # texted), and calling it either would tell the operator something untrue about whether
          # reminders are going out.
          row[:paused] += 1
        end
      end
    end

    # Texts the house actually tried to send: Twilio was asked, and either took it or refused it.
    # `pending` and `sending` are rows the reminder sweep claimed and SendSmsJob has not finished —
    # normally for seconds, but for as long as Twilio is unreachable or the queue is stuck.
    # Counting those as texts would turn a morning when forty reminders stranded into a row
    # reading "40 texts, 0 failed", which is the exact opposite of what happened.
    ATTEMPTED_STATUSES = SmsMessage::STATUSES.values_at(:sent, :delivered, :failed).freeze
    UNSENT_STATUSES = SmsMessage::STATUSES.values_at(:pending, :sending).freeze

    # Attempted, failed and stranded in one grouped pass, read back out of the same result rather
    # than costing a query each.
    def text_counts
      counted = SmsMessage.joins(:member)
        .where(members: { group_id: group_ids }, created_at: now - TEXTS_WINDOW..)
        .group("members.group_id", :status)
        .count

      counted.each_with_object({}) do |((group_id, status), count), totals|
        row = totals[group_id] ||= { attempted: 0, unsent: 0, failed: 0 }
        row[:attempted] += count if ATTEMPTED_STATUSES.include?(status)
        row[:unsent] += count if UNSENT_STATUSES.include?(status)
        row[:failed] += count if status == SmsMessage::STATUSES.fetch(:failed)
      end
    end

    # "When did anything last happen here." Today that is the house's last text, preferring the
    # moment it actually went out and falling back to the moment the row was claimed, because a
    # text that never made it past `pending` still says somebody's rota ran.
    #
    # TODO: fold in `users.last_seen_at` and `members.last_seen_at` once
    # https://linear.app/bloombase/issue/BLO-1671 adds them — the plan's definition is the latest
    # of the last text, the last admin seen and the last member seen, and only the first of those
    # three exists yet.
    def last_activity
      SmsMessage.joins(:member)
        .where(members: { group_id: group_ids })
        .group("members.group_id")
        .maximum(Arel.sql("COALESCE(sms_messages.sent_at, sms_messages.created_at)"))
    end
  end
end
