module Webhooks
  # Twilio's delivery receipts. This is the endpoint that turns "I never got the text" from a shrug
  # into a carrier status.
  #
  # It is the one route in the app with no bearer token, because Twilio has no way to carry one.
  # What it has instead is a signature: an HMAC of the exact URL it called plus every parameter it
  # posted, keyed by our auth token. Without a valid one, this endpoint changes nothing — an
  # unsigned caller could otherwise mark every reminder in the house `delivered`.
  #
  # There is deliberately no rate limit here yet: the endpoint fails closed (403) and touches no
  # database row before the signature check, so the only unauthenticated cost is HMAC CPU.
  # BLO-1048 adds the Rack::Attack throttle alongside the member routes.
  class TwilioStatusController < ApplicationController
    before_action :verify_twilio_signature

    # Twilio's MessageStatus values that are worth recording. `queued`, `sending` and `sent` say
    # nothing the row does not already say.
    TERMINAL_STATUSES = {
      "delivered" => "delivered",
      "undelivered" => "failed",
      "failed" => "failed"
    }.freeze

    def create
      # Act ONLY on the exact parameters the signature covered. `params` merges the query string
      # OVER the request body, but the signature is computed against the body alone
      # (request.request_parameters). Reading the SID or status from `params` would let anyone take
      # one validly body-signed callback, append `?MessageSid=<victim>&MessageStatus=failed`, and
      # flip a message they hold no signature for — the signature check would pass and change the
      # wrong row. The signed set is the only trustworthy input.
      callback = request.request_parameters

      # A blank SID is not a lookup — it is a landmine. Every `pending` and `sending` row carries a
      # NULL twilio_sid (the sweep claims the row before rendering), so `find_by(twilio_sid: nil)`
      # matches an arbitrary unsent row, and a signed callback with no MessageSid would flip it to
      # delivered or failed. Refuse the blank before it reaches the database.
      return head :no_content if callback["MessageSid"].blank?

      message = SmsMessage.find_by(twilio_sid: callback["MessageSid"])
      status = TERMINAL_STATUSES[callback["MessageStatus"].to_s]

      # An unknown SID (a message from another environment sharing this Twilio account, say) and an
      # intermediate status are both "nothing to do", not errors — a 4xx would only make Twilio
      # retry the same callback for hours. And status only ever advances: once a row is delivered or
      # failed it is terminal. Twilio signatures carry no nonce, so a captured callback can be
      # replayed verbatim; refusing to move a terminal row is what stops a replayed `failed` from
      # undoing a real delivery.
      #
      # Residual race (accepted, follow-up ticket): SendSmsJob writes the SID in the same UPDATE that
      # moves the row to `sent`, immediately after Twilio's 201, so the window is sub-millisecond. A
      # delivery callback that beat that write would find no row and be dropped, and Twilio (given a
      # 204) would not retry. The window is as small as it can be without a SID we do not yet have.
      if message && status && !message.delivered? && !message.failed?
        message.update!(status: status, error_code: callback["ErrorCode"].presence)
      end

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
