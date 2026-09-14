module Api
  # GET /api/member/schedule — the WHOLE house's upcoming rota, as one member sees it.
  #
  # The member page used to ask only "what am I down for?" (Api::MemberShiftsController). To hand a
  # shift off sensibly a member needs the rest of the picture: who else lives here, what else is on
  # this week, and who is already busy. That is one payload rather than three round trips, because
  # the page renders it as a single chronological feed and a partial answer would flicker.
  #
  # Flat under Api, like its two siblings, NOT nested in an Api::Member module — see the note at the
  # top of MemberBaseController for why that module would shadow the ::Member model.
  class MemberSchedulesController < MemberBaseController
    def show
      group = current_member.group
      today = group.today
      rotas = visible_rotas(group)
      # EVERY member of the house, active or not, because the two lists this feeds want different
      # sets. The people list is the active ones; a shift can still name a departed housemate (see
      # `upcoming_shifts`). One query answers both, and `active` is a column already on the row, so
      # narrowing it here is a `select` and not a second trip.
      #
      # `:id` after `:name` because nothing stops two housemates sharing a name, and an ORDER BY that
      # cannot tell them apart lets Postgres return them in either order, so the people list could
      # differ between two identical requests. The id settles it the same way every time.
      members = group.members.order(:name, :id).to_a

      render json: {
        today: today.iso8601,
        timezone: group.timezone,
        member: member_ref(current_member),
        members: members.select(&:active?).map { |member| schedule_member_ref(member) },
        rotas: rotas.map { |rota| { id: rota.id, name: rota.name } },
        shifts: upcoming_shifts(rotas, members, today).map { |shift| serialize_shift(shift, today: today) },
        events: CalendarEventSerializer.many(house_events(group, today))
      }
    end

    private

    # Active rotas with a roster. `draft?` is DERIVED from the roster (Rota#draft?), never stored, so
    # it cannot be a WHERE clause; `includes(:rota_positions)` loads every roster in one extra query
    # and the reject runs in Ruby without an N+1.
    def visible_rotas(group)
      group.rotas.active.includes(:rota_positions).order(:name).reject(&:draft?)
    end

    # Every upcoming shift of those rotas. Shift id breaks a tie between two shifts of the same rota
    # on the same day, which the (rota_id, due_on) uniqueness makes impossible today but which keeps
    # the order total anyway. The join stays: it is what `rotas.name` in the ORDER BY reads, and the
    # feed's order is part of the payload.
    #
    # There is no `preload(:rota, :assigned_member, :covering_member)` here any more (BLO-1698). The
    # action has already loaded every rota and every member of this house a few lines up, so those
    # three preloads were three round trips that could only come back holding rows already sitting in
    # memory. Attaching the objects to the associations by hand is the same eager load, done from what
    # is already in hand rather than from Postgres, and the serializer cannot tell the difference.
    #
    # `members` is the WHOLE house, not `active`, which is the whole reason it is passed in rather
    # than derived here. A shift can legitimately name a deactivated member: MemberRemoval leaves
    # today's shifts untouched (they are history, and the day-of reminder has gone out), and it leaves
    # a future shift the leaver was ASSIGNED alone when somebody else is covering it. Indexing only
    # the active members would miss exactly those rows and quietly fall back to a query per shift.
    def upcoming_shifts(rotas, members, today)
      shifts = Shift.joins(:rota)
        .where(rota_id: rotas.map(&:id))
        .upcoming(today)
        .order(:due_on, "rotas.name", :id)
        .to_a

      rotas_by_id = rotas.index_by(&:id)
      members_by_id = members.index_by(&:id)

      shifts.each do |shift|
        attach(shift, :rota, rotas_by_id[shift.rota_id])
        attach(shift, :assigned_member, members_by_id[shift.assigned_member_id])
        attach(shift, :covering_member, members_by_id[shift.covering_member_id])
      end
    end

    # Hand an association the record it would otherwise have gone and fetched. Nothing happens when
    # there is no record to hand it. An uncovered shift has no covering member, and a row naming
    # somebody this house does not have would be a bug rather than a payload to change silently, so
    # the association stays unloaded and Active Record resolves it the ordinary way.
    def attach(shift, name, record)
      shift.association(name).target = record if record
    end

    # The house calendar's current and upcoming entries (BLO-1667, spec section 9).
    #
    # The window is bounded on `ends_on`, not on `starts_on`: a housemate who flew to Greece last
    # Friday and is back on Thursday is away TODAY, and dropping their row because the trip started
    # in the past is exactly the fact the hand-off screen exists to show. There is no upper bound to
    # pair with it, because CalendarSync never stores more than 90 days ahead. A second condition
    # would filter nothing, and would quietly tie the member payload to the sync's window.
    #
    # Ordering is date, then clock, then id. An all-day row has no clock, so Postgres sorts its null
    # `starts_at` after the appointments it shares a day with; id only breaks the tie between two
    # all-day rows on the same day, and is there so the feed cannot reshuffle between two requests.
    #
    # `includes` covers both associations the serializer reaches for: the away roster, and the
    # group whose zone turns a stored instant into the wall clock the house wrote down. A calendar
    # with thirty entries therefore costs two extra queries rather than sixty.
    def house_events(group, today)
      connection = group.calendar_connection
      return CalendarEvent.none if connection.nil?

      connection.calendar_events
        .where(ends_on: today..)
        .includes(:calendar_event_members, calendar_connection: :group)
        .order(:starts_on, :starts_at, :id)
    end

    # `contactable` folds "active and not opted out" into the one boolean the page acts on: an
    # opted-out housemate is still shown (they live here) but cannot be handed a shift, because the
    # cover action would reject them.
    def schedule_member_ref(member)
      member_ref(member).merge(contactable: member.contactable?)
    end
  end
end
