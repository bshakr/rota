module Sms
  # Asks Twilio what it charged for texts that have already gone out, and writes the answer onto the
  # row that spent the money (BLO-1672).
  #
  # This exists because the price is not in the create response. Twilio settles a charge minutes
  # after delivery, and the status webhook does not carry it either, so the only way to learn what a
  # text cost is to go back and fetch the message. Every call this class makes is a GET; it cannot
  # send anything, which is what makes it safe to point at production.
  #
  # Two callers, one walk. BackfillSmsPricesJob runs it nightly over the last seven days — far more
  # room than settling needs, so a few missed nights still cost nothing. `bin/rails
  # twilio:backfill_prices` runs it over the whole history, once, slowly.
  #
  # Resumable by construction: eligibility is "has a SID and has never been asked about", so an
  # interrupted run simply leaves the rest for the next one, and a doubled run finds nothing to redo.
  class PriceBackfill
    # Twilio's REST API tolerates a few hundred calls without complaint, and a sweep is not worth
    # being greedy over. Hitting the cap is not a failure: what this run does not reach is still
    # unasked, which is precisely what the next run looks for.
    DEFAULT_LIMIT = 500

    # What a walk did. `halted` is nil on a clean finish, or the reason it stopped early.
    #
    # priced    — Twilio gave a settled charge and the row now carries it.
    # pending   — Twilio has the message but has not priced it yet; the row was left for next time.
    # no_record — Twilio has forgotten the message; the row is marked asked, with no price.
    # errored   — Twilio refused that one row; it was skipped and left for a human to notice.
    Outcome = Data.define(:priced, :pending, :no_record, :errored, :halted) do
      def asked = priced + pending + no_record + errored
    end

    def initialize(sleep_between: 0, limit: DEFAULT_LIMIT)
      @sleep_between = sleep_between.to_f
      @limit = limit
    end

    # `scope` narrows *which* rows to consider — a window, or the whole table. Which of those are
    # worth asking about is this class's own rule, applied on top.
    #
    # Oldest first, always: a settled price cannot become unsettled, so the oldest unasked row is
    # the one most likely to have an answer waiting, and for the history backfill it is also the one
    # closest to ageing out of Twilio's retention.
    def call(scope = SmsMessage.all)
      counts = { priced: 0, pending: 0, no_record: 0, errored: 0 }
      halted = nil

      rows(scope).each_with_index do |message, index|
        pause if index.positive?
        result = record_price(message)
        counts[result] += 1
        yield(message, result) if block_given?
      rescue Sms::TransientFailure => e
        # Twilio is rate limiting, or is down. Every remaining row would get the same answer, so
        # stop rather than hammer it. Nothing is lost: these rows are still unasked, and this is a
        # backfill, not a send — being a day late costs nobody a text.
        halted = "#{e.class}: #{e.message}"
        break
      rescue Sms::PermanentFailure => e
        # Twilio has a settled opinion about this one row, and it is not a price. Skip it and carry
        # on with the rest; the row stays unasked so the problem stays visible rather than being
        # buried under a price_fetched_at that claims we got an answer.
        Rails.logger.warn("Sms::PriceBackfill could not price #{message.twilio_sid}: #{e.class}: #{e.message}")
        counts[:errored] += 1
        yield(message, :errored) if block_given?
      end

      Outcome.new(**counts, halted: halted)
    end

    private

    attr_reader :sleep_between, :limit

    def rows(scope)
      scope.awaiting_price.order(:created_at).limit(limit)
    end

    def record_price(message)
      price = Sms.fetch_price(message.twilio_sid)

      # Twilio has the message but has not settled its charge. Leave price_fetched_at null so the
      # next run picks the row up again — writing it now would bury the cost of this text forever.
      return :pending if price.nil?

      message.update!(price: price.amount, price_unit: price.unit, price_fetched_at: Time.current)
      :priced
    rescue Sms::MessageNotFound
      # Past Twilio's retention, or deleted. No price is ever coming, so mark the row asked and stop
      # carrying it. `price` stays null, which reads as "no figure" rather than "free".
      message.update!(price_fetched_at: Time.current)
      :no_record
    end

    # Politeness, and the only thing standing between a thirteen-month backfill and a rate limit.
    def pause
      sleep(sleep_between) if sleep_between.positive?
    end
  end
end
