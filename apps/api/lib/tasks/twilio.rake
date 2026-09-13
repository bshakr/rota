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
  # gone out (Sms::PriceBackfill -> Sms.fetch_price -> the adapter's fetch_price). That is what makes
  # it safe to point at production, and spec/lib/tasks/twilio_rake_spec.rb asserts it.
  #
  # Interruptible. Eligibility is "has a SID and has never been asked about", so a run that is
  # stopped, rate limited, or capped by BACKFILL_LIMIT simply picks up where it left off next time.
  desc "Ask Twilio what it charged for every text it has a record of and record it. Reads only, never sends."
  task :backfill_prices, [ :sleep_between ] => :environment do |_task, args|
    # A quarter of a second is polite by default: Twilio would tolerate far more, but this task is
    # run by hand against production and has all night if it needs it.
    sleep_between = (args[:sleep_between] || ENV["BACKFILL_SLEEP"] || 0.25).to_f
    limit = (ENV["BACKFILL_LIMIT"] || 5_000).to_i

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
         "#{outcome.no_record} with no Twilio record, #{outcome.errored} refused."
    puts "Stopped early: #{outcome.halted}" if outcome.halted
    remaining = SmsMessage.awaiting_price.count
    puts "#{remaining} rows still unpriced — run this again to continue." if remaining.positive?
  end
end
