# The single locked path for changing a shift's cover — the `covering_member` column.
#
# FOUR code paths write that column, and before this only one locked: a member handing a shift on or
# taking it back (MemberCoversController), an admin overriding it (Api::ShiftsController#update),
# RotaRegenerator deleting and regenerating a rota's future shifts, and MemberRemoval clearing a
# departing member's covers. They must not interleave. An unlocked read-check-update can lost-update a
# cover another path committed a moment earlier, and — because a cover notice is an unrecallable text —
# announce a cover that gets overwritten, or fire for a shift regeneration has since deleted.
#
# So every change goes through here (the two cover-writers) or takes the same lock in the same order
# (RotaRegenerator and MemberRemoval): the ROTA row lock, acquired BEFORE any shift row, and among
# several rotas in ascending id order. That single rule — rota -> shift, ids ascending — is what makes
# all four writers mutually exclusive with no possibility of a deadlock cycle. The shift is re-read
# FOR UPDATE inside the lock and the caller's guard is re-evaluated against that committed state, not
# against whatever the request read before it queued for the lock, so the loser of a race is rejected
# rather than overwriting the winner.
#
# The lock is the rota, not the shift, deliberately: it is the only lock RotaRegenerator and
# MemberRemoval can be made to share (both work a whole rota's window at once). The cost — cover
# changes to two DIFFERENT shifts of the same rota now serialise rather than running in parallel — is
# nothing for a house rota, where cover changes are rare and a rota holds a handful of people.
#
# ShiftCover owns only the lock, the write, and (inside the lock) recording the cover notices. Each
# caller keeps its OWN rules (the guard) and its own idea of who to tell (`notify`), because those
# genuinely differ: the member path has the hand-on/take-back rules and texts the affected parties;
# the admin override has its own rules and sends nothing. The guard returns an error token (nil to
# proceed), carried back untouched in Result#error for the caller to render.
class ShiftCover
  Result = Data.define(:shift, :error, :previous_responsible, :new_responsible, :notices) do
    def ok? = error.nil?
  end

  # `to` is the member who should end up covering the shift, or nil to clear the cover. `notify`, if
  # given, is called INSIDE the lock with (shift, previous_responsible, new_responsible) and returns
  # the ids of the cover-notice rows it recorded — laying them down atomically with the cover change,
  # so a rolled-back or regenerated-away change leaves no stranded notice. The caller enqueues those
  # ids AFTER this returns (i.e. after the transaction commits).
  def self.change(shift:, to:, notify: nil)
    error = nil
    before = nil
    after = nil
    notices = []

    shift.rota.with_lock do
      shift.lock! # re-read FOR UPDATE; RecordNotFound (the caller's 404) if regeneration deleted it
      error = yield(shift)
      next if error

      before = shift.responsible_member
      shift.update!(covering_member: to)
      after = shift.responsible_member
      notices = Array(notify.call(shift, before, after)) if notify
    end

    Result.new(shift: shift, error: error, previous_responsible: before, new_responsible: after,
      notices: notices)
  end
end
