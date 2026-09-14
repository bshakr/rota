# The hourly reminder sweep — the most important recurring job in the system. See config/recurring.yml.
#
# It runs the reconciliation (ReminderSweep) for every active rota, asking "what reminders should
# have gone out by now, and haven't?" Running hourly rather than firing on the send hour is the whole
# point: a worker that was down, a deploy that landed on the hour, and a clock that skipped the hour
# in spring are all recovered on the next pass, because the sweep recomputes the answer from scratch
# instead of relying on having been awake at the right minute. Multi-day reminders heal for the full
# 24h staleness window; the day-of reminder is best-effort within its own calendar day (see
# ReminderSweep). It is never a lost multi-day reminder, only a late one.
class ReminderSweepJob < ApplicationJob
  # A check-in per run, so that "the sweep did not happen at all" is an alert rather than a silence.
  # The per-rota rescue below cannot answer that question: a worker that is down raises nothing,
  # reports nothing, and simply produces no events. A missed check-in is the only shape that failure
  # has. The margin is 15 minutes, which survives a deploy landing on the hour and still catches a
  # dead worker well before the next send hour. Every Sentry.capture_check_in is a no-op with no
  # DSN, so development and the specs are unaffected.
  include Sentry::Cron::MonitorCheckIns
  sentry_monitor_check_ins slug: "reminder-sweep",
    monitor_config: Sentry::Cron::MonitorConfig.from_interval(1, :hour, checkin_margin: 15, max_runtime: 30, timezone: "UTC")

  queue_as :default

  # Wrapped in a JobRun so the operator dashboard can answer "when did the sweep last finish?".
  # Solid Queue's own record of the run is deleted hourly by `clear_solid_queue_finished_jobs`, and
  # this is the job whose silence costs the most: a sweep that stopped running is a house that
  # stopped being texted, with nothing anywhere else that says so. See JobRun.
  def perform
    JobRun.record(JobRun::REMINDER_SWEEP) { sweep_every_active_rota }
  end

  private

  # Inside the loop, not around it: the JobRun wrapper in `perform` must still write a row on a
  # pass that touched nothing, because "the sweep ran and there was nothing to do" and "the sweep
  # stopped running" are the two things the operator's system health tile exists to tell apart.
  #
  # `Group.live` drops the rotas of a house an operator has paused (BLO-1675). Reminders are never
  # *claimed* while it is paused — no sms_messages row is written — so resuming does not fire a
  # backlog: ReminderSweep's 24-hour staleness guard buries every moment that passed in the
  # meantime, exactly as it does after an outage.
  def sweep_every_active_rota
    Rota.active.joins(:group).merge(Group.live).includes(:group).find_each do |rota|
      ReminderSweep.new(rota).call
    rescue StandardError => e
      # Every group's rota is swept in this one loop, so a single rota that raises must not starve
      # every house after it in the iteration order — one house's bad data cannot be allowed to stop
      # another's reminders. Report it and carry on; the next hourly run picks the rota up again once
      # it is fixed, and a missed hour is exactly what the reconciliation is built to heal.
      #
      # Log as well as report, and do not drop the log line as duplication. `report` now reaches
      # somebody: sentry-rails registers a subscriber on `Rails.error` (see
      # config/initializers/sentry.rb), so this becomes an issue in the api project, tagged with the
      # source below. The log line stays because it answers a different question — Sentry says a rota
      # broke, the Railway log says what else this process was doing in the same hour — and because
      # the reporter is disabled in development and test, where the log line is still the whole alarm.
      Rails.logger.error("ReminderSweepJob failed for rota #{rota.id}: #{e.class}: #{e.message}")
      Rails.error.report(e, context: { rota_id: rota.id }, source: "rotamonster.reminder_sweep")
    end
  end
end
