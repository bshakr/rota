# Removing a member from the house. Never a destroy — a member who appears anywhere in shift
# history is a record of who was actually responsible, and deleting them would rewrite the past
# (Member guards this with `restrict_with_error`). So removal is deactivation plus the cleanup of
# everything they were still on the hook for in the future, and the whole point of this service is
# to say EXACTLY what changed so the admin is never surprised by a reassignment they didn't see.
#
# Two things a departing member is on the hook for, and they are handled differently:
#
#   - Turns they were ASSIGNED (and nobody is covering). These get redistributed to the people who
#     remain, by regenerating each rota's roster. The rotation itself moves on.
#   - Covers they had AGREED to take for other people. These are undone: the shift reverts to whoever
#     it was assigned to. This is the case the ticket calls out by name — a cover is an agreement
#     made over dinner, not a slot in a rotation, and it has to be named when it is torn up.
#
# Shifts they are assigned but somebody else is covering are left alone: the person responsible is
# the cover, unaffected by this member leaving. Only strictly-future shifts are touched; today's and
# every past shift are immutable history, and today's day-of reminder has already gone out.
class MemberRemoval
  # `reassigned` and `dropped_covers` are the two enumerations the admin sees. Both are resolved to
  # names, not ids alone — this ends up in a sentence a human reads.
  Result = Data.define(:reassigned, :dropped_covers)

  def initialize(member)
    @member = member
    @group = member.group
    @today = @group.today
  end

  def call
    Member.transaction do
      lock_affected_rotas!                # take the rota locks BEFORE any shift, in id order
      to_reassign = pending_assignments   # snapshot BEFORE the roster moves them
      dropped = drop_future_covers        # undo the agreements, and name them
      regenerate_affected_rosters         # remove from rosters, redistribute the assigned turns
      @member.update!(active: false)

      Result.new(reassigned: resolve(to_reassign), dropped_covers: dropped)
    end
  end

  private

  attr_reader :member, :group, :today

  # Every writer of a shift's cover takes the shift's rota lock before the shift itself, in the same
  # rota -> shift order, so none of them can deadlock (see ShiftCover). This service writes covers —
  # `drop_future_covers`'s bulk UPDATE, and RotaRegenerator's deletes — across POTENTIALLY SEVERAL
  # rotas, so it must take all of their locks first, and in a deterministic order among themselves, or
  # two concurrent removals whose rota sets overlap would deadlock each other. Lock ascending by id,
  # one row at a time: a single `ORDER BY id ... FOR UPDATE` locks rows as the scan reads them (before
  # the sort), so per-row locking is what actually guarantees the acquisition order. RotaRegenerator's
  # inner `rota.with_lock` then re-locks a row this transaction already holds — a no-op on the same
  # connection.
  def lock_affected_rotas!
    affected_rota_ids.each { |id| Rota.where(id: id).lock.first }
  end

  # The rotas whose shifts this removal will lock: the ones the member sits on (whose rosters
  # regenerate) and the ones holding shifts the member is covering (whose covers get cleared).
  def affected_rota_ids
    covering_rota_ids = future_shifts.where(covering_member_id: member.id).distinct.pluck(:rota_id)
    (member.rota_ids + covering_rota_ids).uniq.sort
  end

  # Every strictly-future shift in the group. One cutoff for the whole group, because every rota in
  # it shares the group's calendar (see Group#today).
  def future_shifts
    Shift.where(rota_id: group.rotas.select(:id)).future(today)
  end

  # The turns this member would have taken: assigned to them, and not covered by anyone else, so they
  # really are the one responsible. Captured as (rota, due_on) because after regeneration the row
  # itself is gone — deleted and rebuilt under a new id — and (rota, due_on) is what survives to look
  # the replacement up by.
  def pending_assignments
    future_shifts
      .where(assigned_member_id: member.id, covering_member_id: nil)
      .includes(:rota)
      .map { |shift| { rota: shift.rota, due_on: shift.due_on } }
  end

  # The covers this member had agreed to take for others. Named against the person whose shift it is
  # — "you were covering Bob's bins on Sat 5 Jul" — then cleared, so responsibility falls back to
  # that assignee. Cleared in one UPDATE; these rows are not regenerated here (the cover flow, not the
  # rotation, put the member on them), so the revert is the whole change.
  def drop_future_covers
    covered = future_shifts.where(covering_member_id: member.id).includes(:rota, :assigned_member).to_a

    summaries = covered.map do |shift|
      {
        shift_id: shift.id,
        rota_id: shift.rota_id,
        rota_name: shift.rota.name,
        due_on: shift.due_on,
        reverts_to_member_id: shift.assigned_member_id,
        reverts_to_member_name: shift.assigned_member.name
      }
    end

    Shift.where(id: covered.map(&:id)).update_all(covering_member_id: nil) if covered.any?
    summaries
  end

  # Only the rotas this member actually sat on have a roster to rebuild. Their positions go, then each
  # regenerates — RotaRegenerator#roster_changed deletes the uncovered future shifts and reassigns
  # them from the remaining order, while leaving any covered shift exactly as it stands.
  def regenerate_affected_rosters
    rotas = member.rotas.to_a
    member.rota_positions.destroy_all
    rotas.each { |rota| RotaRegenerator.new(rota).roster_changed }
  end

  # After the dust settles, who actually holds each turn the member gave up. Looked up by (rota,
  # due_on): the shift may be a brand-new row, or gone entirely if the member was the rota's last
  # person and it is now a draft — in which case there is no one, and the UI says so.
  def resolve(assignments)
    assignments.map do |assignment|
      rota = assignment[:rota]
      shift = rota.shifts.includes(:assigned_member, :covering_member).find_by(due_on: assignment[:due_on])
      now = shift&.responsible_member

      {
        rota_id: rota.id,
        rota_name: rota.name,
        due_on: assignment[:due_on],
        now_assigned_member_id: now&.id,
        now_assigned_member_name: now&.name
      }
    end
  end
end
