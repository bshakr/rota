module Sms
  # The real thing. The only place in the app that constructs a Twilio client.
  #
  # Named TwilioAdapter rather than Twilio so that `Twilio::REST::Client` inside `module Sms` still
  # means the gem.
  class TwilioAdapter
    # Twilio's own advice: 429 is "slow down", 5xx is "we are having a moment", and both are worth
    # waiting out. Every other 4xx is a statement about this message — an unroutable number, a
    # blocked recipient — and will be repeated verbatim on every retry.
    RETRYABLE_STATUS_CODES = [ 429 ].freeze

    def deliver(to:, body:, status_callback:)
      message = client.messages.create(
        from: Rails.configuration.x.twilio.from_number,
        to: to,
        body: body,
        status_callback: status_callback
      )

      # `num_segments` is the only cost figure a create response carries, and Twilio is the one that
      # counts it: the split depends on the encoding, and a single emoji drops a body from 160 GSM-7
      # characters to 70 UTF-16 ones. It arrives as a string, like every number on this wire.
      Delivery.new(sid: message.sid, status: message.status, num_segments: message.num_segments&.to_i)
    rescue ::Twilio::REST::RestError => e
      raise failure_class(e).new(e.message, error_code: e.code.to_s)
    rescue ::Twilio::REST::TwilioError => e
      # Everything below the HTTP response: a dropped connection, a timeout, DNS. twilio-ruby wraps
      # Faraday's errors in this. Nothing about the message is wrong, so it is worth another go.
      raise TransientFailure, e.message
    end

    # What Twilio charged for a message it already sent. A GET — this method cannot send anything,
    # which is what makes the price backfill safe to run against production.
    #
    # Twilio settles a charge minutes after delivery, so a freshly sent message comes back with a
    # null price: nil here means "ask again tomorrow", not "free". The charge itself arrives as a
    # NEGATIVE string ("-0.00790") because Twilio reports it as a debit against the account balance.
    # Recorded spend is positive, so the sign is flipped here, at the boundary.
    def fetch_price(sid)
      message = client.messages(sid).fetch
      return nil if message.price.blank?

      Price.new(amount: BigDecimal(message.price.to_s).abs, unit: message.price_unit.presence&.upcase)
    rescue ::Twilio::REST::RestError => e
      # A 404 is not a failure to be retried: Twilio does not have this message and never will
      # again, so the caller needs to tell it apart from every other refusal.
      raise MessageNotFound, "Twilio has no record of #{sid}" if e.status_code == 404

      raise failure_class(e).new(e.message, error_code: e.code.to_s)
    rescue ::Twilio::REST::TwilioError => e
      raise TransientFailure, e.message
    end

    private

    def failure_class(error)
      retryable = error.status_code >= 500 || RETRYABLE_STATUS_CODES.include?(error.status_code)
      retryable ? TransientFailure : PermanentFailure
    end

    def client
      ::Twilio::REST::Client.new(
        Rails.configuration.x.twilio.account_sid,
        Rails.configuration.x.twilio.auth_token
      )
    end
  end
end
