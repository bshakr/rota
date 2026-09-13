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

    # Twilio keeps message records for about thirteen months. Sixty days is nowhere near that, which
    # is the point: inside it, a message Twilio does not recognise is one we are asking the wrong
    # account about, not one it has forgotten. See #handle_missing.
    RETENTION_HORIZON = 60.days

    # A walk that opens with nothing but 404s is not looking at a settled history. Stop and say so
    # rather than let a misconfigured account mark the rest of the table asked.
    NOT_FOUND_ABORT_THRESHOLD = 25

    # What a walk did. `halted` is nil on a clean finish, or the reason it stopped early.
    #
    # priced    — Twilio gave a settled charge and the row now carries it.
    # pending   — Twilio has the message but has not priced it yet; the row was left for next time.
    # aged_out  — the message predates Twilio's retention; the row is marked asked, with no price.
    # unmatched — Twilio does not recognise a recent SID; the row is left untouched, for a human.
    # errored   — Twilio refused that one row; it was skipped and left for a human to notice.
    Outcome = Data.define(:priced, :pending, :aged_out, :unmatched, :errored, :halted) do
      def asked = priced + pending + aged_out + unmatched + errored
    end

    def initialize(sleep_between: 0, limit: DEFAULT_LIMIT)
      @sleep_between = sleep_between.to_f
      @limit = limit
      # One adapter for the whole walk, resolved through the same config seam Sms.deliver uses. A
      # fresh one per row would mean a fresh Twilio client per row, and with it a fresh TLS
      # handshake — the difference between one connection and one per message across a backfill.
      @adapter = Sms.adapter
    end

    # `scope` narrows *which* rows to consider — a window, or the whole table. Which of those are
    # worth asking about is this class's own rule, applied on top.
    #
    # Oldest first, always: a settled price cannot become unsettled, so the oldest unasked row is
    # the one most likely to have an answer waiting, and for the history backfill it is also the one
    # closest to ageing out of Twilio's retention.
    def call(scope = SmsMessage.all)
      counts = { priced: 0, pending: 0, aged_out: 0, unmatched: 0, errored: 0 }
      halted = nil

      rows(scope).each_with_index do |message, index|
        pause if index.positive?
        result = record_price(message)
        counts[result] += 1
        yield(message, result) if block_given?

        halted = wrong_account_halt(counts)
        break if halted
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

    attr_reader :sleep_between, :limit, :adapter

    def rows(scope)
      scope.awaiting_price.order(:created_at).limit(limit)
    end

    def record_price(message)
      price = adapter.fetch_price(message.twilio_sid)

      # Twilio has the message but has not settled its charge. Leave price_fetched_at null so the
      # next run picks the row up again — writing it now would bury the cost of this text forever.
      return :pending if price.nil?

      warn_unexpected_currency(message, price)
      # update_columns, not update!: the only validation a price write could trip is the uniqueness
      # check on twilio_sid, which would cost a SELECT on every priced row and could raise partway
      # through a walk over something this class never touched. update_columns does not maintain
      # timestamps, so updated_at is set by hand.
      message.update_columns(
        price: price.amount,
        price_unit: price.unit,
        price_fetched_at: Time.current,
        updated_at: Time.current
      )
      :priced
    rescue Sms::MessageNotFound
      handle_missing(message)
    end

    # A 404 means one of two very different things, and reading it the wrong way round is the most
    # expensive mistake this class can make.
    #
    # Past the retention horizon it means what it says: Twilio has forgotten the message, no price
    # is ever coming, and the row is marked asked so the sweep stops carrying it forever.
    #
    # Inside the horizon it almost certainly means we are asking the wrong account. Twilio puts the
    # Account SID in the request path, and Rollout step 5 has the one-off run against a TEST
    # credential — which owns none of production's messages and would 404 every one of them. Marking
    # those rows asked would write off the whole recoverable history in a single pass with nothing
    # to undo it, so a recent 404 changes nothing on the row and is left for a human.
    def handle_missing(message)
      if message.created_at < RETENTION_HORIZON.ago
        message.update_columns(price_fetched_at: Time.current, updated_at: Time.current)
        return :aged_out
      end

      Rails.logger.warn(
        "Sms::PriceBackfill: Twilio does not recognise #{message.twilio_sid}, sent #{message.created_at.to_date}. " \
        "Leaving the row unasked — a message this recent should be known to the account we are asking."
      )
      :unmatched
    end

    # Nothing but 404s from the very first row. The walk is oldest-first, so this is the shape both
    # a forgotten history and a wrong Account SID make; stop either way. The first is nothing to
    # hurry over, and the second must not be allowed to mark the rest of the table asked. At most
    # NOT_FOUND_ABORT_THRESHOLD rows can be written off before this fires.
    def wrong_account_halt(counts)
      return nil unless counts[:priced].zero? && counts[:pending].zero? && counts[:errored].zero?
      return nil if counts[:aged_out] + counts[:unmatched] < NOT_FOUND_ABORT_THRESHOLD

      "#{NOT_FOUND_ABORT_THRESHOLD} messages in a row were unknown to Twilio. Either they predate " \
        "Twilio's retention, or TWILIO_ACCOUNT_SID does not own them — stopped before a wrong " \
        "account could write off the rest."
    end

    # Twilio bills a UK number in GBP and a US one in USD, and a spend page that adds the two
    # together is wrong in a way nobody notices. The figure is stored as reported either way; this
    # is the line that makes the day it first happens findable.
    def warn_unexpected_currency(message, price)
      return if price.unit.blank? || price.unit == "USD"

      Rails.logger.warn(
        "Sms::PriceBackfill: #{message.twilio_sid} was billed in #{price.unit}, not USD. " \
        "Stored as reported — any total that mixes currencies must group by price_unit."
      )
    end

    # Politeness, and the only thing standing between a thirteen-month backfill and a rate limit.
    def pause
      sleep(sleep_between) if sleep_between.positive?
    end
  end
end
