module Webhooks
  # Twilio's delivery receipts. This is the endpoint that turns "I never got the text" from a shrug
  # into a carrier status.
  #
  # It is the one route in the app with no bearer token, because Twilio has no way to carry one.
  # What it has instead is a signature: an HMAC of the exact URL it called plus every parameter it
  # posted, keyed by our auth token. Without a valid one, this endpoint changes nothing — an
  # unsigned caller could otherwise mark every reminder in the house `delivered`.
  class TwilioStatusController < ApplicationController
    before_action :verify_twilio_signature

    # Twilio's MessageStatus values that are worth recording. `queued`, `sending` and `sent` say
    # nothing the row does not already say, and callbacks can arrive out of order — applying them
    # could walk a `delivered` row backwards into `sent`.
    TERMINAL_STATUSES = {
      "delivered" => "delivered",
      "undelivered" => "failed",
      "failed" => "failed"
    }.freeze

    def create
      message = SmsMessage.find_by(twilio_sid: params[:MessageSid])
      status = TERMINAL_STATUSES[params[:MessageStatus].to_s]

      # An unknown SID (a message from another environment sharing this Twilio account, say) and an
      # intermediate status are both "nothing to do", not errors. A 4xx would only make Twilio
      # retry the same callback for hours.
      message&.update!(status: status, error_code: params[:ErrorCode].presence) if status

      head :no_content
    end

    private

    # Validated against the URL we *gave* Twilio, not the URL this request appears to have arrived
    # at. Twilio signs the callback URL it was handed; behind a TLS-terminating proxy
    # `request.original_url` can come back as http:// against Twilio's https://, and every webhook
    # in production would then fail its signature check and every message would sit at `sent`
    # forever. The URL we sent is the one thing both ends provably agree on.
    def verify_twilio_signature
      validator = Twilio::Security::RequestValidator.new(Rails.configuration.x.twilio.auth_token)
      signature = request.headers["X-Twilio-Signature"].to_s

      return if validator.validate(Sms.status_callback_url, request.request_parameters, signature)

      head :forbidden
    end
  end
end
