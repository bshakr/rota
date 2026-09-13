# The outbound text path: render a body, hand it to an adapter, get a SID back.
#
# Nothing else in the app talks to Twilio. SendSmsJob calls `Sms.deliver`; which adapter that
# reaches is config (see config/initializers/sms.rb), which is what lets development log a message
# instead of sending it and lets the specs stub the wire. The money side goes through the same
# seam in the other direction: Sms::PriceBackfill takes one adapter from `Sms.adapter` and asks it
# what Twilio charged — a read, never a send — so "nothing else talks to Twilio" stays true.
module Sms
  # A text that did not go out, carrying whatever the carrier said about why. The distinction
  # between the two subclasses is the only thing SendSmsJob needs in order to decide between
  # retrying and giving up — and Sms::PriceBackfill reads them the same way: transient means ask
  # again later, permanent means do not bother.
  class DeliveryFailure < StandardError
    attr_reader :error_code

    def initialize(message = nil, error_code: nil)
      super(message)
      @error_code = error_code
    end
  end

  # Twilio said no, and would say no again: a bad number, a blocked recipient, a template we cannot
  # render. Retrying spends money and time to be told the same thing, so the row fails now and
  # records why.
  class PermanentFailure < DeliveryFailure; end

  # Twilio, or the network between here and it, is having a moment. Worth waiting out — Solid Queue
  # retries with backoff, and only a run of failures becomes a terminal one.
  class TransientFailure < DeliveryFailure; end

  # Twilio has no record of a SID we sent it: the message was deleted, or it aged out of Twilio's
  # roughly thirteen-month retention. Distinct from "not priced yet" on purpose — no price is ever
  # coming for this one, so the backfill marks the row asked and stops carrying it forever.
  class MessageNotFound < StandardError; end

  # A template made it to send time carrying a placeholder we have no value for. Rota validation is
  # what should have caught this at save; if it reaches here, fail loudly rather than text
  # somebody the literal string "{{nmae}}".
  class UnknownPlaceholder < PermanentFailure
    def initialize(names)
      super("unknown placeholder(s): #{names.join(', ')}", error_code: SmsMessage::INVALID_TEMPLATE)
    end
  end

  # A template with an unbalanced or stray brace — `Hi {{name}`. Same failure class as an unknown
  # placeholder: it should have been rejected at save, and texting the literal braces out is exactly
  # the un-recallable mistake the validation exists to prevent.
  class MalformedTemplate < PermanentFailure
    def initialize(_template = nil)
      super("template has an unbalanced or stray brace", error_code: SmsMessage::INVALID_TEMPLATE)
    end
  end

  class << self
    def deliver(to:, body:)
      adapter.deliver(to: to, body: body, status_callback: status_callback_url)
    end

    # The URL Twilio posts delivery receipts to — and, because Twilio signs the exact URL it was
    # given, the URL its signature must be checked against. Built from config rather than read back
    # off the inbound request, so a TLS-terminating proxy rewriting the scheme cannot turn every
    # webhook into a silent 403.
    def status_callback_url
      "#{Rails.configuration.x.sms.api_url}#{Rails.application.routes.url_helpers.twilio_status_webhook_path}"
    end

    def adapter
      case Rails.configuration.x.sms.adapter.to_s
      when "twilio" then TwilioAdapter.new
      when "null" then NullAdapter.new
      else raise ArgumentError, "unknown SMS adapter #{Rails.configuration.x.sms.adapter.inspect}"
      end
    end
  end

  # What an adapter hands back: enough to record the send, to match up the status webhook later,
  # and to estimate what the text cost until Twilio settles a real price for it.
  Delivery = Data.define(:sid, :status, :num_segments)

  # Twilio's settled charge for one message: an amount the app's way up (positive) and the currency
  # it was billed in. Twilio reports it as a negative string; the sign is flipped at the adapter so
  # nothing downstream has to remember that Twilio counts the other way.
  Price = Data.define(:amount, :unit)
end
