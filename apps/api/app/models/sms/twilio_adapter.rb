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

    OPEN_TIMEOUT = 10
    TIMEOUT = 30

    # Errors Net::HTTP can only raise before a byte of the request is written.
    CONNECT_ONLY_ERRORS = [ SocketError, Errno::ECONNREFUSED, Net::OpenTimeout ].freeze

    # One recipient gets a handful of texts a day from us, and the attempt being looked for is at
    # most a few hours old.
    LOOKUP_LIMIT = 50
    CLOCK_SKEW = 1.minute

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
      # Below the HTTP response, so Twilio never answered. Only a failure to connect proves the
      # request never left; anything later may have been accepted with the reply lost.
      raise (never_reached_twilio?(e) ? TransientFailure : AmbiguousFailure), e.message
    end

    # A message Twilio holds from our number to `to`, with this exact body, created since the
    # ambiguous attempt. Filtered here rather than by Twilio's DateSent, which is null while a
    # message is still queued. Any failure is transient: a lookup that cannot answer must not be
    # read as "not sent".
    def find_sent(to:, body:, since:, excluding_sids: [])
      candidates = client.messages.list(to: to, from: Rails.configuration.x.twilio.from_number, limit: LOOKUP_LIMIT)
      found = candidates.find do |message|
        message.body == body && message.date_created && message.date_created >= since - CLOCK_SKEW &&
          excluding_sids.exclude?(message.sid)
      end
      return nil if found.nil?

      Delivery.new(sid: found.sid, status: found.status, num_segments: found.num_segments&.to_i)
    rescue ::Twilio::REST::TwilioError => e
      raise TransientFailure.new(e.message, error_code: e.respond_to?(:code) ? e.code.to_s : nil)
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

    def never_reached_twilio?(error)
      root = error
      root = root.cause while root.cause
      return true if CONNECT_ONLY_ERRORS.any? { |klass| root.is_a?(klass) }
      # Net::HTTP#connect re-raises TCP connect errors with this message; the same errno raised
      # mid-request has no such prefix.
      return true if root.is_a?(SystemCallError) && root.message.include?("Failed to open TCP connection")

      root.is_a?(OpenSSL::SSL::SSLError) && root.message.start_with?("SSL_connect")
    end

    def failure_class(error)
      retryable = error.status_code >= 500 || RETRYABLE_STATUS_CODES.include?(error.status_code)
      retryable ? TransientFailure : PermanentFailure
    end

    # Memoised per adapter instance, so anything holding one adapter across many calls — the price
    # backfill walking a long history — reuses a single client and its connection rather than
    # paying for a new TLS handshake on every message. A send builds one adapter per text and is
    # unaffected either way.
    def client
      @client ||= ::Twilio::REST::Client.new(
        Rails.configuration.x.twilio.account_sid,
        Rails.configuration.x.twilio.auth_token,
        nil,
        nil,
        http_client
      )
    end

    # twilio-ruby applies one timeout to both phases; its connection hook runs after that, so the
    # connect phase can be made shorter. Net::HTTP's default is 60 s each.
    def http_client
      ::Twilio::HTTP::Client.new(timeout: TIMEOUT).tap do |http|
        http.configure_connection { |faraday| faraday.options.open_timeout = OPEN_TIMEOUT }
      end
    end
  end
end
