# The hourly reminder sweep — the most important recurring job in the system. See config/recurring.yml.
#
# It runs the reconciliation (ReminderSweep) for every active rota, asking "what reminders should
# have gone out by now, and haven't?" Running hourly rather than firing on the send hour is the whole
# point: a worker that was down, a deploy that landed on the hour, and a clock that skipped the hour
# in spring all heal on the next pass, because the sweep recomputes the answer from scratch instead
# of relying on having been awake at the right minute.
class ReminderSweepJob < ApplicationJob
  queue_as :default

  def perform
    Rota.active.includes(:group).find_each do |rota|
      ReminderSweep.new(rota).call
    rescue StandardError => e
      # Every group's rota is swept in this one loop, so a single rota that raises must not starve
      # every house after it in the iteration order — one house's bad data cannot be allowed to stop
      # another's reminders. Report it and carry on; the next hourly run picks the rota up again once
      # it is fixed, and a missed hour is exactly what the reconciliation is built to heal.
      #
      # Log as well as report, and do not drop the log line as duplication. `Rails.error` has no
      # subscribers in this app yet, so `report` alone is a no-op — a rescue that swallowed a house's
      # reminders in silence and still finished GREEN would turn "the sweep is broken" into a bug
      # whose first symptom is a house that quietly stopped being texted. The log line is the only
      # thing that makes this visible today; `report` is what carries it to Sentry once a subscriber
      # exists.
      Rails.logger.error("ReminderSweepJob failed for rota #{rota.id}: #{e.class}: #{e.message}")
      Rails.error.report(e, context: { rota_id: rota.id }, source: "houserota.reminder_sweep")
    end
  end
end
