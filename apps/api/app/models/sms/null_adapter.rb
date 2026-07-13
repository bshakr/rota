module Sms
  # Development's adapter: writes the message to the log and invents a SID.
  #
  # No HTTP client is constructed and no credential is read, so a developer running `bin/jobs`
  # against a rota full of real phone numbers cannot text anybody, whatever is in .env.
  class NullAdapter
    def deliver(to:, body:, status_callback:)
      Rails.logger.info(<<~LOG)
        [Sms::NullAdapter] not sending an SMS. To: #{to}. Status callback: #{status_callback}.
        #{redact_magic_link(body)}
      LOG

      # Shaped like a Twilio SID (SM + 32 hex) because everything downstream — the sms_messages
      # unique index, the SMS log — treats it as one. `queued` is what Twilio itself returns from
      # a create; the status webhook that would later move it on is never going to fire.
      Delivery.new(sid: "SM#{SecureRandom.hex(16)}", status: "queued")
    end

    private

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
