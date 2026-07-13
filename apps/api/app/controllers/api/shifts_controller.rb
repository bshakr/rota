module Api
  # Shifts are read per rota and written one at a time. The write is the admin override: setting or
  # clearing a shift's cover directly, the same `covering_member_id` the member cover flow sets, but
  # from the admin's side of the app.
  class ShiftsController < BaseController
    # Nested under a rota: GET /api/rotas/:rota_id/shifts. Upcoming only — the calendar looks forward,
    # and past shifts are history read elsewhere. Assigned and covering members are eager-loaded so a
    # 90-day window is a handful of queries, not one per row.
    def index
      rota = group_scope(:rotas).find(params[:rota_id])
      shifts = rota.shifts.upcoming(current_group.today)
        .includes(:assigned_member, :covering_member).order(:due_on)
      render json: { shifts: ShiftSerializer.many(shifts) }
    end

    # PATCH /api/shifts/:id — set or clear the cover. `group_scope(:shifts)` roots the lookup in the
    # token's group (Group has_many :shifts through :rotas), so another house's shift id is a 404.
    def update
      shift = group_scope(:shifts).find(params[:id])

      # A past shift records what actually happened; overriding it would rewrite history. Today's is
      # still fair game — the day-of reminder resolves the cover at send time, so a same-day override
      # still reaches the right person.
      if shift.due_on < current_group.today
        return render_problem("shift_in_the_past", :unprocessable_content,
          message: "This shift has already passed and cannot be changed.")
      end

      guard = cover_guard(shift)
      return guard if guard

      shift.update!(covering_member_id: cover_member_id)
      render json: { shift: ShiftSerializer.one(shift.reload) }
    end

    private

    # nil clears the cover; an id sets it. `key?` distinguishes "clear it" (covering_member_id: null)
    # from a request that simply didn't mention it — though the route only reaches here for an update,
    # so a missing key is treated as a clear.
    def cover_member_id
      params[:covering_member_id].presence
    end

    # The model already refuses a cover from another group or one equal to the assignee. This adds the
    # rule the model has no reason to hold but an override must: you cannot hand a turn to someone who
    # has left the house. An inactive cover would be a reminder sent to nobody — the silent miss this
    # product exists to prevent. Clearing a cover (nil) is always allowed.
    def cover_guard(shift)
      id = cover_member_id
      return if id.nil?

      member = group_scope(:members).find_by(id: id)
      return render_problem("member_not_found", :unprocessable_content,
        message: "That member is not part of this group.") if member.nil?

      return if member.active?

      render_problem("member_inactive", :unprocessable_content,
        message: "#{member.name} has been removed and cannot cover a shift.")
    end
  end
end
