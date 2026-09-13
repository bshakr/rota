# Stubs for Twilio's REST API. No spec ever reaches the real thing — spec/support/webmock.rb
# blocks the network outright, and spec/sms/no_live_sms_spec.rb proves it.
module TwilioStubs
  MESSAGES_URL_PATTERN = %r{\Ahttps://api\.twilio\.com/2010-04-01/Accounts/[^/]+/Messages\.json\z}
  # A GET on one message, which is how a settled price is read back after the text has gone out.
  MESSAGE_URL_PATTERN = %r{\Ahttps://api\.twilio\.com/2010-04-01/Accounts/[^/]+/Messages/[^/]+\.json\z}

  # Twilio's own shape for a freshly created message. Every number it returns is a string on the
  # wire, `num_segments` included; turning that into an integer is the adapter's job, so the stub
  # must not quietly do it here.
  def stub_twilio_send(sid: "SM#{SecureRandom.hex(16)}", status: "queued", num_segments: "1")
    stub_request(:post, MESSAGES_URL_PATTERN).to_return(
      status: 201,
      headers: { "Content-Type" => "application/json" },
      body: { sid: sid, status: status, num_segments: num_segments }.to_json
    )
  end

  # Twilio's record of a message it already sent. `price` is a NEGATIVE string, because Twilio
  # reports a charge as a debit against the account balance, and it is null until the charge
  # settles — which is minutes after delivery, long after the create response came back.
  def stub_twilio_fetch(sid:, price: "-0.00790", price_unit: "USD", status: "delivered", num_segments: "1")
    stub_request(:get, twilio_message_url(sid)).to_return(
      status: 200,
      headers: { "Content-Type" => "application/json" },
      body: { sid: sid, status: status, price: price, price_unit: price_unit, num_segments: num_segments }.to_json
    )
  end

  # Twilio has no record of this SID: deleted, or past its roughly thirteen-month retention.
  def stub_twilio_fetch_missing(sid:, code: 20_404)
    stub_request(:get, twilio_message_url(sid)).to_return(
      status: 404,
      headers: { "Content-Type" => "application/json" },
      body: { code: code, message: "The requested resource was not found", status: 404 }.to_json
    )
  end

  # Twilio rate limiting, or having a moment, on the read path.
  def stub_twilio_fetch_error(sid:, status: 429, code: 20_429, message: "Too Many Requests")
    stub_request(:get, twilio_message_url(sid)).to_return(
      status: status,
      headers: { "Content-Type" => "application/json" },
      body: { code: code, message: message, status: status }.to_json
    )
  end

  def twilio_message_url(sid)
    "https://api.twilio.com/2010-04-01/Accounts/#{Rails.configuration.x.twilio.account_sid}/Messages/#{sid}.json"
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
