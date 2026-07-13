# Tops every active rota's shift window back up to 90 days. Runs daily — see config/recurring.yml.
#
# The whole job is idempotent, because ShiftGenerator inserts missing rows only. A retry, an
# overlap with a rota edit that generated synchronously, or a second run in the same day all cost
# a few no-op queries and nothing else. That is what makes it a reconciliation loop rather than a
# one-shot: it does not care what happened yesterday, only whether the window is full now.
class TopUpShiftWindowsJob < ApplicationJob
  queue_as :default

  def perform
    Rota.active.includes(:group).find_each do |rota|
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
      Rails.error.report(e, context: { rota_id: rota.id }, source: "houserota.shift_generation")
    end
  end
end
