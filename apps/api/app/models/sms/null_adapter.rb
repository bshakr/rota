module Sms
  # Development's adapter: writes the message to the log and invents a SID.
  #
  # No HTTP client is constructed and no credential is read, so a developer running `bin/jobs`
  # against a rota full of real phone numbers cannot text anybody, whatever is in .env.
  class NullAdapter
    def deliver(to:, body:, status_callback:)
      Rails.logger.info(<<~LOG)
        [Sms::NullAdapter] not sending an SMS. To: #{to}. Status callback: #{status_callback}.
        #{body}
      LOG

      # Shaped like a Twilio SID (SM + 32 hex) because everything downstream — the sms_messages
      # unique index, the SMS log — treats it as one. `queued` is what Twilio itself returns from
      # a create; the status webhook that would later move it on is never going to fire.
      Delivery.new(sid: "SM#{SecureRandom.hex(16)}", status: "queued")
    end
  end
end
