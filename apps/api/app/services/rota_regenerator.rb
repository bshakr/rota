# The regeneration rules. Two kinds of config change, two different rules, and the difference
# between them is the whole point.
#
# A ROSTER change (add / remove / reorder members) leaves the dates alone: the same series, worked
# by different people. So the future is rebuilt — but any shift that already carries a cover is
# PRESERVED. Alice's arrangement with Bob survives you adding Dave. That row is not a slot in the
# rotation any more, it is the record of an agreement two people made over dinner, and the admin
# did not ask to cancel it.
#
# A SCHEDULE change (`starts_on` or `interval_*`) moves the dates themselves, so the shifts that
# were generated no longer exist in the new series. There is nothing left to preserve a cover
# *onto*: the 5th of July simply is not a shift any more. Every future shift goes, covers
# included — which is why this is the change the admin has to confirm, and why
# #schedule_change_warning exists to tell them what it will cost.
#
# Neither rule ever touches a shift on or before the group's today. Past shifts are immutable
# history, and today's day-of reminder has already gone out.
class RotaRegenerator
  # `deleted` and `inserted` are counts; `dropped_covers` is the same payload
  # #schedule_change_warning returns, so the UI can confirm and then report with one shape.
  Outcome = Data.define(:deleted, :inserted, :dropped_covers)

  def initialize(rota)
    @rota = rota
  end

  # Call after the roster has been saved.
  def roster_changed
    regenerate { future_shifts.uncovered }
  end

  # Call after the new `starts_on` / `interval_*` has been saved — and only once the admin has
  # confirmed the warning below, because this is where the covers go.
  def schedule_changed
    regenerate { future_shifts }
  end

  # What a schedule change would cost, without doing it. This is what the admin sees in the
  # confirm dialog.
  #
  # It must be called BEFORE the new `starts_on` / `interval_*` is saved. Afterwards the dates have
  # already moved and the covers it is meant to name are attached to a series that no longer
  # exists — it would still return an answer, just not the one anybody asked for.
  def schedule_change_warning
    { future_shifts: future_shifts.count, covers_dropped: cover_summaries(future_shifts.covered) }
  end

  private

  attr_reader :rota

  def regenerate
    dropped = []
    deleted = 0
    inserted = 0

    # One transaction, because a delete that lands without its regenerate leaves a hole in the
    # schedule and nobody assigned to clean. One row lock, because two admins saving at once would
    # otherwise interleave their deletes and inserts into a series that is neither of theirs.
    #
    # ShiftGenerator on its own needs neither — ON CONFLICT DO NOTHING is what makes the daily
    # top-up safe to run concurrently. It is deleting that has to be serialised.
    rota.with_lock do
      doomed = yield
      dropped = cover_summaries(doomed.covered)
      # `destroy_all`, not `delete_all`. sms_messages carries a plain foreign key on shift_id with
      # no cascade, so a shift whose reminder has already gone out cannot simply be deleted —
      # Postgres would refuse. The bound is one rota's 90-day window, so the row-at-a-time cost is
      # not worth optimising away.
      deleted = doomed.destroy_all.size
      inserted = ShiftGenerator.new(rota).call
    end

    Outcome.new(deleted: deleted, inserted: inserted, dropped_covers: dropped)
  end

  # Strictly after the group's own today. See Group#today for why that is not `Date.current`.
  def future_shifts
    rota.shifts.future(rota.group.today)
  end

  # Names, not just ids: this ends up in a sentence an admin reads before they press Confirm, and
  # "shift 4013 loses its cover" is not a sentence.
  def cover_summaries(scope)
    scope.includes(:assigned_member, :covering_member).map do |shift|
      {
        shift_id: shift.id,
        due_on: shift.due_on,
        assigned_member_id: shift.assigned_member_id,
        assigned_member_name: shift.assigned_member.name,
        covering_member_id: shift.covering_member_id,
        covering_member_name: shift.covering_member.name
      }
    end
  end
end
