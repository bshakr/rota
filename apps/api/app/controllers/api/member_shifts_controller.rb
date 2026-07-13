module Api
  # GET /api/member/shifts — the whole read surface of the member path: this member's upcoming shifts
  # across every rota in their group, plus the people they could ask to cover.
  class MemberShiftsController < MemberBaseController
    def index
      today = current_member.group.today

      shifts = Shift.upcoming(today)
        .involving(current_member)
        .includes(:rota, :assigned_member, :covering_member)
        .order(:due_on)

      render json: {
        member: member_ref(current_member),
        shifts: shifts.map { |shift| serialize_shift(shift, today: today) },
        coverable_members: coverable_members.map { |member| member_ref(member) }
      }
    end

    private

    # Everyone this member could hand a shift to: contactable (active and not opted out), in the same
    # group, and not themselves. It is exactly the set a cover assignment will accept, so the page
    # never offers a name the API would then reject.
    def coverable_members
      current_member.group.members.contactable.where.not(id: current_member.id).order(:name)
    end
  end
end
