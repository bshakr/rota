# Tops every active rota's shift window back up to 90 days. Runs daily — see config/recurring.yml.
#
# The whole job is idempotent, because ShiftGenerator inserts missing rows only. A retry, an
# overlap with a rota edit that generated synchronously, or a second run in the same day all cost
# a few no-op queries and nothing else. That is what makes it a reconciliation loop rather than a
# one-shot: it does not care what happened yesterday, only whether the window is full now.
class TopUpShiftWindowsJob < ApplicationJob
  queue_as :default

  # Wrapped in a JobRun so the operator dashboard can answer "when did the top-up last finish?".
  # It runs daily, so a failure nobody notices has a whole day to shrink every house's shift window
  # before it could show up anywhere, and Solid Queue's own record of the run is deleted hourly by
  # `clear_solid_queue_finished_jobs`. See JobRun.
  def perform
    JobRun.record(JobRun::TOP_UP_SHIFT_WINDOWS) { top_up_every_active_rota }
  end

  private

  # Inside the loop, not around it, for the same reason the reminder sweep puts it there: the
  # JobRun wrapper in `perform` still has to write a row on a pass that generated nothing.
  #
  # `Group.live` leaves a paused house's shift window where it is (BLO-1675). Nothing is deleted and
  # the existing shifts stay exactly as they were; the window simply stops being topped up, and the
  # next daily run after a resume fills it back to ninety days in one pass, because this job asks
  # only whether the window is full now.
  def top_up_every_active_rota
    Rota.active.joins(:group).merge(Group.live).includes(:group).find_each do |rota|
      ShiftGenerator.new(rota).call
    rescue StandardError => e
      # Every group's rota is generated in this one loop, so a single rota that raises must not be
      # allowed to starve every group after it in the iteration order — a house does not lose its
      # cleaning schedule because a different house has bad data. Report it and carry on; the next
      # daily run picks the rota up again once it is fixed, and costs nothing if it was already
      # fine.
      #
      # Log it as well as report it, and do not be tempted to drop the log line as duplication.
      # `Rails.error` has no subscribers in this app yet, so `report` on its own is a genuine no-op
      # — a rescue that swallowed every rota in silence and still finished GREEN would turn "the
      # generator is broken for everyone" into a bug whose first symptom is a house that quietly
      # stopped being texted. The log line is the only thing that makes this failure visible today;
      # `report` is what will carry it to Sentry the day a subscriber is added.
      Rails.logger.error("TopUpShiftWindowsJob failed for rota #{rota.id}: #{e.class}: #{e.message}")
      Rails.error.report(e, context: { rota_id: rota.id }, source: "rotamonster.shift_generation")
    end
  end
end
