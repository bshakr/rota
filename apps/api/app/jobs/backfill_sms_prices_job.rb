# Nightly: asks Twilio what it charged for the texts that went out this week, and records it on the
# rows that spent the money (BLO-1672). Runs on the clock; see config/recurring.yml.
#
# The price is never in the create response — Twilio settles a charge minutes after delivery, and
# the status webhook does not carry it — so it has to be fetched afterwards. Seven days is far more
# room than settling needs; the slack is there so that a few nights of missed runs still cost
# nothing. Anything older than the window belongs to the one-off `bin/rails twilio:backfill_prices`,
# which walks the whole history once rather than every night.
#
# Idempotent and resumable, the way TopUpShiftWindowsJob is: eligibility is "has a SID and has never
# been asked about", so a doubled run finds nothing to redo and an interrupted one leaves the rest
# for tomorrow. Reads only — nothing on this path can send a text.
class BackfillSmsPricesJob < ApplicationJob
  # A check-in per run. The job is silent by design when there is nothing to price, so the log line
  # below is the only sign it ran, and nobody reads a log for a line that is missing. A missed
  # check-in is what turns "the spend page has shown estimates for a week" into an alert on the
  # first night the worker failed to start it. Daily at 04:40 UTC (config/recurring.yml); an hour
  # of margin, because a late night's prices are still settled by the next one.
  include Sentry::Cron::MonitorCheckIns
  sentry_monitor_check_ins slug: "backfill-sms-prices",
    monitor_config: Sentry::Cron::MonitorConfig.from_crontab("40 4 * * *", checkin_margin: 60, max_runtime: 60, timezone: "UTC")

  queue_as :default

  WINDOW = 7.days

  def perform
    outcome = Sms::PriceBackfill.new.call(SmsMessage.where(created_at: WINDOW.ago..))

    # The sweep is silent by design when it has nothing to do, so this line is the only way to see
    # that it ran at all — and the only way "Twilio has been rate limiting us for a week" surfaces
    # before the spend page starts showing estimates where settled prices should be.
    Rails.logger.info(
      "BackfillSmsPricesJob asked=#{outcome.asked} priced=#{outcome.priced} pending=#{outcome.pending} " \
      "aged_out=#{outcome.aged_out} unmatched=#{outcome.unmatched} errored=#{outcome.errored} " \
      "halted=#{outcome.halted.inspect}"
    )
  end
end
