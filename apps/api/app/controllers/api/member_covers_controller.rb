module Api
  # POST/DELETE /api/member/shifts/:id/cover — the member path's one write.
  #
  # Two rules, from the spec, govern who may act on a shift:
  #   1. Whoever is currently responsible can hand it on (assign). Bob, having taken Alice's shift,
  #      can pass it to Cara.
  #   2. The original assignee can always take it back (cancel). The escape hatch for "actually, I'm
  #      around after all."
  #
  # The lock that makes this safe under concurrency lives in ShiftCover, which every writer of a
  # shift's cover goes through. This controller supplies the member rules as a guard (re-evaluated
  # inside the lock) and, on success, texts the affected parties. A cross-group shift id is a 404
  # (see MemberBaseController), which keeps a token from one house from probing another's shift ids.
  class MemberCoversController < MemberBaseController
    ERROR_MESSAGES = {
      past_shift: "This shift can no longer be covered.",
      not_responsible: "You are not responsible for this shift.",
      cover_unavailable: "That member isn't available to take this shift.",
      self_cover: "You can't hand a shift to yourself.",
      already_assignee: "That member is already assigned to this shift.",
      not_covered: "This shift isn't currently covered.",
      not_original_assignee: "Only the original person for this shift can take it back."
    }.freeze

    def create
      shift = group_shifts.find(params[:id])
      cover = group_members.find_by(id: cover_params[:covering_member_id])

      render_cover_result ShiftCover.change(shift: shift, to: cover, notify: method(:record_notices)) { |locked|
        assignment_error(locked, cover)
      }
    end

    def destroy
      shift = group_shifts.find(params[:id])

      render_cover_result ShiftCover.change(shift: shift, to: nil, notify: method(:record_notices)) { |locked|
        cancellation_error(locked)
      }
    end

    private

    # Everyone whose turn actually changed, minus the caller, who acted from the page and already sees
    # the result. Comparing responsibility before and after covers every case in one line: on assign
    # the new cover; on cancel the person who was covering; on a re-assignment the newcomer. Run INSIDE
    # ShiftCover's lock so the rows are laid down atomically with the change; the ids come back so the
    # controller can enqueue the sends after the lock commits.
    def record_notices(shift, previous_responsible, new_responsible)
      affected = [ previous_responsible, new_responsible ].uniq - [ current_member ]
      CoverNotice.record(shift: shift, to: affected)
    end

    def render_cover_result(result)
      return render_cover_error(result.error) unless result.ok?

      CoverNotice.enqueue(result.notices)
      render json: { shift: serialize_shift(result.shift) }
    end

    def assignment_error(shift, cover)
      return :past_shift unless future?(shift)
      return :not_responsible unless responsible?(shift)
      # Re-read the cover's state under the lock: a member removal that raced this request has, by the
      # time we hold the rota lock, committed its deactivation, so a just-removed member is caught here
      # rather than assigned. (SendSmsJob's own contactable check is the backstop for the narrow
      # cross-rota window this does not serialise.)
      cover&.reload
      return :cover_unavailable if cover.nil? || !cover.contactable?
      return :self_cover if cover.id == current_member.id
      # covering == assigned is nonsensical (it would be a cancel, not a hand-on) and the Shift model
      # rejects it outright; name it here so the caller gets a reason rather than a 500.
      return :already_assignee if cover.id == shift.assigned_member_id

      nil
    end

    def cancellation_error(shift)
      return :past_shift unless future?(shift)
      return :not_covered unless shift.covered?
      return :not_original_assignee unless shift.assigned_member_id == current_member.id

      nil
    end

    # "In the future" means strictly after the group's today: today's shift is already immutable
    # history in the making (its day-of reminder has or will fire today), so it can no longer be
    # handed off. Matches Shift.future and the regeneration boundary.
    def future?(shift)
      shift.due_on > current_member.group.today
    end

    def responsible?(shift)
      shift.responsible_member.id == current_member.id
    end

    # Rooted in the member's group, so `find` raises RecordNotFound (=> 404) for any shift outside it.
    def group_shifts
      Shift.joins(:rota).where(rotas: { group_id: current_member.group_id })
    end

    def group_members
      current_member.group.members
    end

    def cover_params
      params.permit(:covering_member_id)
    end

    def render_cover_error(code)
      render json: { error: code, message: ERROR_MESSAGES.fetch(code) }, status: :unprocessable_content
    end
  end
end
