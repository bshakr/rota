# Tops every active rota's shift window back up to 90 days. Runs daily — see config/recurring.yml.
#
# The whole job is idempotent, because ShiftGenerator inserts missing rows only. A retry, an
# overlap with a rota edit that generated synchronously, or a second run in the same day all cost
# a few no-op queries and nothing else. That is what makes it a reconciliation loop rather than a
# one-shot: it does not care what happened yesterday, only whether the window is full now.
class TopUpShiftWindowsJob < ApplicationJob
  # A check-in per run: a worker that never starts this job produces no exception and no event, so a
  # missed check-in is the only evidence that the shift windows have stopped being topped up. The
  # margin is an hour, because nothing breaks the moment a daily top-up is late — the window is 90
  # days deep and a day shorter costs nobody a shift.
  include Sentry::Cron::MonitorCheckIns
  sentry_monitor_check_ins slug: "top-up-shift-windows",
    monitor_config: Sentry::Cron::MonitorConfig.from_crontab("0 3 * * *", checkin_margin: 60, max_runtime: 60, timezone: "UTC")

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
      # `report` now has a subscriber: sentry-rails registers one on `Rails.error` (see
      # config/initializers/sentry.rb), so this reaches the api project as an issue tagged with the
      # source below. The log line stays regardless — it is what a human reads next to everything
      # else this process did, and it is the whole alarm in development and test, where the reporter
      # is disabled.
      Rails.logger.error("TopUpShiftWindowsJob failed for rota #{rota.id}: #{e.class}: #{e.message}")
      Rails.error.report(e, context: { rota_id: rota.id }, source: "rotamonster.shift_generation")
    end
  end
end
