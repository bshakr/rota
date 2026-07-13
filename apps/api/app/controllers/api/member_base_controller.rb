module Api
  # Every member magic-link endpoint inherits from here. It is the twin of Api::BaseController, but
  # for the member path: authentication is by member token (MemberAuthenticatable), not a WorkOS JWT,
  # and there is no tenant scoping to inherit because a member IS a single tenant-bound record — every
  # query roots in `current_member`, which cannot reach another group.
  #
  # NOTE the controllers are Api::MemberShiftsController and Api::MemberCoversController, flat under
  # Api, rather than nested under an Api::Member module. An `Api::Member` module would shadow the
  # ::Member model constant inside these controllers (Ruby resolves `Member` up the lexical nesting
  # and would find the module first), so a bare `Member.find_by(...)` would silently mean the module.
  # Keeping the namespace flat removes that trap entirely.
  class MemberBaseController < ApplicationController
    # Never routed to directly; it exists to be inherited from.
    abstract!

    include MemberAuthenticatable

    # A shift id that does not belong to this member's group is indistinguishable, to them, from an id
    # that never existed: 404, never 403, so the member path leaks nothing about other houses' shifts.
    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: "not_found" }, status: :not_found
    end

    private

    # The one JSON shape for a shift, shared by the list and by the cover actions so a shift reads the
    # same everywhere. `today` is passed in so a list of shifts resolves the group's "today" once
    # rather than per row.
    def serialize_shift(shift, today: current_member.group.today)
      future = shift.due_on > today

      {
        id: shift.id,
        rota_id: shift.rota_id,
        rota_name: shift.rota.name,
        due_on: shift.due_on.iso8601,
        covered: shift.covered?,
        assigned_member: member_ref(shift.assigned_member),
        covering_member: shift.covering_member && member_ref(shift.covering_member),
        responsible_member: member_ref(shift.responsible_member),
        # The two cover rules, resolved for THIS member so the page can show the right button and
        # never offer an action the API would reject. Assign: rule 1, whoever is currently
        # responsible may hand it on. Cancel: rule 2, the original assignee may take it back.
        can_assign_cover: future && shift.responsible_member.id == current_member.id,
        can_cancel_cover: future && shift.covered? && shift.assigned_member_id == current_member.id
      }
    end

    def member_ref(member)
      { id: member.id, name: member.name }
    end
  end
end
