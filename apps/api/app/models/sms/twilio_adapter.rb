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

      Delivery.new(sid: message.sid, status: message.status)
    rescue ::Twilio::REST::RestError => e
      raise failure_class(e).new(e.message, error_code: e.code.to_s)
    rescue ::Twilio::REST::TwilioError => e
      # Everything below the HTTP response: a dropped connection, a timeout, DNS. twilio-ruby wraps
      # Faraday's errors in this. Nothing about the message is wrong, so it is worth another go.
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
