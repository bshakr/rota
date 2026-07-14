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
    #
    # The write goes through ShiftCover, the one locked path every writer of a shift's cover shares.
    # Without that, this un-locked read-guard-update could lost-update a cover a member committed a
    # moment earlier (or be overwritten by one), or write over a shift RotaRegenerator is deleting.
    # The guard is re-checked inside the lock; a shift regeneration has since deleted raises
    # RecordNotFound, which BaseController renders as a 404.
    def update
      shift = group_scope(:shifts).find(params[:id])
      cover = cover_member_id ? group_scope(:members).find_by(id: cover_member_id) : nil

      result = ShiftCover.change(shift: shift, to: cover) { |locked| override_error(locked, cover) }
      return render_override_error(result.error, cover) unless result.ok?

      render json: { shift: ShiftSerializer.one(result.shift.reload) }
    end

    private

    # nil clears the cover; an id sets it. `.presence` treats blank as "clear it" — and the route only
    # reaches here for an update, so a missing key is a clear too.
    def cover_member_id
      params[:covering_member_id].presence
    end

    # The admin override's rules, re-checked under the lock. A past shift records what actually
    # happened; overriding it would rewrite history — but today's is still fair game, since the
    # day-of reminder resolves the cover at send time. The model already refuses a cover from another
    # group or one equal to the assignee; this adds the rule the model has no reason to hold but an
    # override must — you cannot hand a turn to someone who has left the house, because an inactive
    # cover is a reminder sent to nobody. Clearing a cover (nil) is always allowed.
    def override_error(shift, cover)
      return :shift_in_the_past if shift.due_on < current_group.today
      return nil if cover_member_id.nil?
      return :member_not_found if cover.nil?

      # Re-read under the lock: a member removal that raced this override has committed its
      # deactivation by the time we hold the rota lock, so a just-removed member is caught here.
      cover.reload
      return :member_inactive unless cover.active?

      nil
    end

    def render_override_error(code, cover)
      case code
      when :shift_in_the_past
        render_problem("shift_in_the_past", :unprocessable_content,
          message: "This shift has already passed and cannot be changed.")
      when :member_not_found
        render_problem("member_not_found", :unprocessable_content,
          message: "That member is not part of this group.")
      when :member_inactive
        render_problem("member_inactive", :unprocessable_content,
          message: "#{cover.name} has been removed and cannot cover a shift.")
      end
    end
  end
end
