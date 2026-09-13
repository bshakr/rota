# Argument parsing for twilio:backfill_prices, kept in a module so a .rake file does not leak a
# name as generic as MINIMUM_SLEEP onto every object in the app.
module TwilioBackfillArgs
  # The floor a typo cannot get under. This task is run by hand against production, and the sleep
  # is the only thing pacing it — "0" or "half" must stop the run, not remove the politeness.
  MINIMUM_SLEEP = 0.1

  module_function

  def seconds(raw, name)
    Float(raw)
  rescue ArgumentError, TypeError
    abort "#{name} must be a number of seconds; got #{raw.inspect}."
  end

  def whole_number(raw, name)
    Integer(raw)
  rescue ArgumentError, TypeError
    abort "#{name} must be a whole number; got #{raw.inspect}."
  end
end

namespace :twilio do
  # The one-off that recovers the spend history (plan, Rollout step 4).
  #
  # BackfillSmsPricesJob keeps the last seven days priced every night. This is what walks everything
  # older — once, after the collectors land. Twilio keeps message records for about thirteen months,
  # so the whole history to date is recoverable; after that the charge is simply gone.
  #
  #   bin/rails twilio:backfill_prices
  #   bin/rails 'twilio:backfill_prices[1.0]'        # a full second between calls
  #   BACKFILL_LIMIT=5000 bin/rails twilio:backfill_prices
  #
  # It READS Twilio and cannot send: the only call it makes is a GET on a message that has already
  # gone out (Sms::PriceBackfill -> the adapter's fetch_price). That is what makes it safe to point
  # at production, and spec/lib/tasks/twilio_rake_spec.rb asserts it.
  #
  # Run it against the account that OWNS these messages. Twilio puts the Account SID in the request
  # path, so a test credential 404s every production message; the walk stops itself rather than
  # marking a history it cannot see as asked, but the run is wasted either way.
  #
  # Interruptible. Eligibility is "has a SID and has never been asked about", so a run that is
  # stopped, rate limited, or capped by BACKFILL_LIMIT simply picks up where it left off next time.
  desc "Ask Twilio what it charged for every text it has a record of and record it. Reads only, never sends."
  task :backfill_prices, [ :sleep_between ] => :environment do |_task, args|
    # Parsed strictly, because `.to_f` reads "half" as 0.0 and would silently take the pacing out of
    # a run against production. A quarter of a second is polite by default: Twilio would tolerate
    # far more, but this is run by hand and has all night if it needs it.
    sleep_between = TwilioBackfillArgs.seconds(
      args[:sleep_between] || ENV["BACKFILL_SLEEP"] || "0.25", "The sleep between calls"
    )
    if sleep_between < TwilioBackfillArgs::MINIMUM_SLEEP
      abort "A #{sleep_between}s gap would hammer Twilio. The floor is #{TwilioBackfillArgs::MINIMUM_SLEEP}s."
    end

    limit = TwilioBackfillArgs.whole_number(ENV["BACKFILL_LIMIT"] || "5000", "BACKFILL_LIMIT")
    abort "BACKFILL_LIMIT must be at least 1; got #{limit}." if limit < 1

    $stdout.sync = true
    # Development's null adapter answers "no price" to everything, which would look exactly like a
    # Twilio that has priced nothing — say so rather than let a run finish with a clean zero.
    unless Rails.configuration.x.sms.adapter.to_s == "twilio"
      puts "SMS_ADAPTER is #{Rails.configuration.x.sms.adapter.inspect}, which has no Twilio account to ask."
      puts "Every row will come back unpriced. Re-run with SMS_ADAPTER=twilio and credentials that can read your messages."
    end

    eligible = SmsMessage.awaiting_price.count
    asking = [ eligible, limit ].min
    puts "#{eligible} sms_messages rows have a Twilio SID and no price yet."
    puts "Asking Twilio about #{asking} of them, oldest first, #{sleep_between}s apart. Nothing is sent."

    seen = 0
    outcome = Sms::PriceBackfill.new(sleep_between: sleep_between, limit: limit).call do |message, result|
      seen += 1
      puts format("  %5d/%-5d  %s  %s  %s", seen, asking, message.created_at.to_date, message.twilio_sid, result)
    end

    puts ""
    puts "Asked #{outcome.asked}: #{outcome.priced} priced, #{outcome.pending} not priced by Twilio yet, " \
         "#{outcome.aged_out} too old for Twilio to remember, #{outcome.unmatched} not recognised by this " \
         "Twilio account, #{outcome.errored} refused."
    puts "Stopped early: #{outcome.halted}" if outcome.halted
    remaining = SmsMessage.awaiting_price.count
    puts "#{remaining} rows still unpriced — run this again to continue." if remaining.positive?
  end
end
