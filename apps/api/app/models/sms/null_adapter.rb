module Sms
  # Development's adapter: writes the message to the log and invents a SID.
  #
  # No HTTP client is constructed and no credential is read, so a developer running `bin/jobs`
  # against a rota full of real phone numbers cannot text anybody, whatever is in .env.
  class NullAdapter
    # Twilio's own segmentation, for GSM-7 bodies: 160 characters alone, 153 each once a message is
    # split, because the concatenation header eats the other seven.
    SINGLE_SEGMENT_LENGTH = 160
    CONCATENATED_SEGMENT_LENGTH = 153

    def deliver(to:, body:, status_callback:)
      Rails.logger.info(<<~LOG)
        [Sms::NullAdapter] not sending an SMS. To: #{to}. Status callback: #{status_callback}.
        #{redact_magic_link(body)}
      LOG

      # Shaped like a Twilio SID (SM + 32 hex) because everything downstream — the sms_messages
      # unique index, the SMS log — treats it as one. `queued` is what Twilio itself returns from
      # a create; the status webhook that would later move it on is never going to fire.
      Delivery.new(sid: "SM#{SecureRandom.hex(16)}", status: "queued", num_segments: segments_in(body))
    end

    # Nothing was sent, so nothing was charged. nil is the same answer Twilio gives for a message it
    # has not priced yet, and it means the backfill leaves the row alone — which is right: inventing
    # a figure here would put money that was never spent onto a development spend page.
    def fetch_price(_sid)
      nil
    end

    private

    # An estimate, and only ever a development one: Twilio counts segments by encoding, and this
    # assumes GSM-7. The real number always comes from Twilio's create response (see TwilioAdapter),
    # so this exists to keep a locally seeded SMS log plausible rather than uniformly 1.
    def segments_in(body)
      length = body.to_s.length
      return 1 if length <= SINGLE_SEGMENT_LENGTH

      (length.to_f / CONCATENATED_SEGMENT_LENGTH).ceil
    end

    # The body ends in the member's magic link, whose token is a permanent, non-expiring bearer
    # credential — the whole reason it is kept out of Rails' request paths is to keep it out of
    # logs, and this log would put it right back. Redact the token so the developer can still read
    # the message without the log becoming a working set of credentials once it ships to an
    # aggregator.
    def redact_magic_link(body)
      body.to_s.gsub(%r{(/s/)[A-Za-z0-9_-]+}, '\1[redacted]')
    end
  end
end
