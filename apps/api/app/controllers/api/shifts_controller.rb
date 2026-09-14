module Api
  # Shifts are read per rota and written one at a time. The write is the admin override: setting or
  # clearing a shift's cover directly, the same `covering_member_id` the member cover flow sets, but
  # from the admin's side of the app.
  class ShiftsController < BaseController
    # Two reads, one action.
    #
    # Nested under a rota (GET /api/rotas/:rota_id/shifts) it answers for that rota, which is what
    # the rota screen asks for. Bare (GET /api/shifts) it answers for the WHOLE house: every
    # upcoming turn of every running rota, in one request. The dashboard used to ask rota by rota
    # and paid a round trip per rota for it (BLO-1697); the house-wide read is the same window and
    # the same serializer plus the rota's name, sorted once by the server so the client never has
    # to merge the lists or look a name up.
    #
    # Upcoming only, on both paths: the calendar looks forward, and past shifts are history read
    # elsewhere. Assigned and covering members are eager-loaded either way, so a 90-day window is a
    # handful of queries and not one per row.
    #
    # The house-wide payload carries ONE extra key per shift, `rota_name`. The nested payload does
    # not, and does not need to: the rota screen already knows whose rota it asked about. A caller
    # reading the whole house does not, and answering with `rota_id` alone would make it look the
    # name up in a rotas list fetched by a SECOND request, which is exactly the bug that was here:
    # a rota that stopped running between the two calls dropped its turns off the dashboard without
    # a word. The name travels with the shift that needs it.
    def index
      # The PATH parameter, not `params`: `?rota_id=` on the bare route must not quietly turn it
      # into the nested one and answer without `rota_name`.
      return render json: { shifts: ShiftSerializer.many(rota_shifts) } if request.path_parameters[:rota_id]

      render json: { shifts: house_shifts.map { |shift| named_shift(shift) } }
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

    def rota_shifts
      rota = group_scope(:rotas).find(params[:rota_id])
      rota.shifts.upcoming(current_group.today)
        .includes(:assigned_member, :covering_member).order(:due_on)
    end

    # Every upcoming shift of the house's RUNNING rotas, ordered the way
    # Api::MemberSchedulesController orders the member feed, so the two surfaces read the same
    # house in the same order.
    #
    # `group_scope(:shifts)` rather than `Shift`: Group has_many :shifts through :rotas, so the
    # scope is ROOTED in the token's group the way every other read in this controller is, and it
    # brings the `rotas` join with it, which is what the `"rotas.name"` ordering sorts on. There is
    # no house id a client could send to widen it.
    #
    # `preload` rather than `includes`: the join is already present, and preload keeps the
    # association loads as separate queries instead of letting Rails collapse them into an
    # eager-load that fights the ORDER BY. Three of them, whatever the size of the house, which is
    # the invariant the request spec pins. The rota is preloaded now too, because the payload names
    # it.
    #
    # Shift id breaks a tie between two shifts of the same rota on the same day, which the
    # (rota_id, due_on) uniqueness makes impossible today but which keeps the order total anyway.
    def house_shifts
      group_scope(:shifts)
        .where(rota_id: running_rotas.map(&:id))
        .upcoming(current_group.today)
        .preload(:assigned_member, :covering_member, :rota)
        .order(:due_on, "rotas.name", :id)
    end

    # The house-wide shape: the shared serializer plus the name of the rota the turn belongs to.
    # Merged here rather than taught to ShiftSerializer, so the nested per-rota payload every other
    # caller reads stays byte for byte what it was.
    def named_shift(shift)
      ShiftSerializer.one(shift).merge(rota_name: shift.rota.name)
    end

    # Active rotas with a roster. `draft?` is DERIVED from the roster (Rota#draft?), never stored,
    # so it cannot be a WHERE clause; `includes(:rota_positions)` loads every roster in one extra
    # query and the reject runs in Ruby without an N+1. Same shape as
    # Api::MemberSchedulesController#visible_rotas, for the same reason.
    def running_rotas
      group_scope(:rotas).active.includes(:rota_positions).reject(&:draft?)
    end

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
