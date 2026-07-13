# Stubs for Twilio's REST API. No spec ever reaches the real thing — spec/support/webmock.rb
# blocks the network outright, and spec/sms/no_live_sms_spec.rb proves it.
module TwilioStubs
  MESSAGES_URL_PATTERN = %r{\Ahttps://api\.twilio\.com/2010-04-01/Accounts/[^/]+/Messages\.json\z}

  # Twilio's own shape for a freshly created message.
  def stub_twilio_send(sid: "SM#{SecureRandom.hex(16)}", status: "queued")
    stub_request(:post, MESSAGES_URL_PATTERN).to_return(
      status: 201,
      headers: { "Content-Type" => "application/json" },
      body: { sid: sid, status: status }.to_json
    )
  end

  # A 4xx with a Twilio error code: this message is wrong and will be wrong on every retry.
  def stub_twilio_error(status: 400, code: 21_211, message: "Invalid 'To' Phone Number")
    stub_request(:post, MESSAGES_URL_PATTERN).to_return(
      status: status,
      headers: { "Content-Type" => "application/json" },
      body: { code: code, message: message, more_info: "https://www.twilio.com/docs/errors/#{code}", status: status }.to_json
    )
  end

  # Twilio itself is having a moment.
  def stub_twilio_server_error(status: 500, code: 20_500)
    stub_twilio_error(status: status, code: code, message: "Internal Server Error")
  end

  # The signature Twilio would send for a webhook it posted to `url` with `params`.
  def twilio_signature_for(params, url: Sms.status_callback_url)
    Twilio::Security::RequestValidator
      .new(Rails.configuration.x.twilio.auth_token)
      .build_signature_for(url, params)
  end
end

RSpec.configure do |config|
  config.include TwilioStubs
end
