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

      render json: {
        today: today.iso8601,
        timezone: group.timezone,
        member: member_ref(current_member),
        members: group.members.active.order(:name).map { |member| schedule_member_ref(member) },
        rotas: rotas.map { |rota| { id: rota.id, name: rota.name } },
        shifts: upcoming_shifts(rotas, today).map { |shift| serialize_shift(shift, today: today) }
      }
    end

    private

    # Active rotas with a roster. `draft?` is DERIVED from the roster (Rota#draft?), never stored, so
    # it cannot be a WHERE clause; `includes(:rota_positions)` loads every roster in one extra query
    # and the reject runs in Ruby without an N+1.
    def visible_rotas(group)
      group.rotas.active.includes(:rota_positions).order(:name).reject(&:draft?)
    end

    # Every upcoming shift of those rotas. `preload` rather than `includes`: the join is already
    # present for the rota-name ordering, and preload keeps the association loads as separate
    # queries instead of letting Rails collapse them into an eager-load that fights the ORDER BY.
    # Shift id breaks a tie between two shifts of the same rota on the same day, which the
    # (rota_id, due_on) uniqueness makes impossible today but which keeps the order total anyway.
    def upcoming_shifts(rotas, today)
      Shift.joins(:rota)
        .where(rota_id: rotas.map(&:id))
        .upcoming(today)
        .preload(:rota, :assigned_member, :covering_member)
        .order(:due_on, "rotas.name", :id)
    end

    # `contactable` folds "active and not opted out" into the one boolean the page acts on: an
    # opted-out housemate is still shown (they live here) but cannot be handed a shift, because the
    # cover action would reject them.
    def schedule_member_ref(member)
      member_ref(member).merge(contactable: member.contactable?)
    end
  end
end
