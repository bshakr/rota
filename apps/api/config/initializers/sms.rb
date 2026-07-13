# Everything the outbound SMS path needs, resolved once, at boot.
#
# It lives here rather than in config/application.rb so that a missing credential is a loud
# failure at boot in production and a working default everywhere else: development and test must
# boot, and run the entire send path, with no Twilio account at all.

Rails.application.configure do
  # In production these are not defaults waiting to be corrected — they are the difference between
  # a text arriving and a text going somewhere else. Say so at boot rather than at 9am.
  required_in_production = lambda do |name|
    value = ENV[name].presence
    next value unless value.nil?
    next nil unless Rails.env.production?

    raise "#{name} must be set in production. The SMS path cannot be guessed at."
  end

  # :twilio really talks to Twilio. :null logs the rendered body and invents a SID.
  #
  # Development defaults to :null so that nobody gets a 3am text about the bins while you are
  # debugging. Test defaults to :twilio *on purpose* — the specs must exercise the real client,
  # the real request shape and the real error handling; WebMock is what stops the request leaving
  # the machine (see spec/support/webmock.rb and spec/sms/no_live_sms_spec.rb).
  #
  # Set SMS_ADAPTER=twilio in development once you have a Twilio *test* credential and want to
  # exercise the wire: test credentials with the magic number +15005550006 return real API
  # responses and deliver nothing.
  config.x.sms.adapter = ENV["SMS_ADAPTER"].presence || (Rails.env.development? ? "null" : "twilio")

  # A null adapter in production would mean every reminder "succeeds" and nobody is ever texted,
  # with a green dashboard the whole way. Refuse to boot instead.
  if Rails.env.production? && config.x.sms.adapter == "null"
    raise "SMS_ADAPTER=null in production would silently text nobody."
  end

  # Baked into every magic link we send. A text is permanent in a way a deploy is not: a link
  # pointing at a dead host cannot be recalled, so this is read from config and never hardcoded.
  config.x.sms.app_url = (required_in_production.call("APP_URL") || "http://localhost:3001").chomp("/")

  # Where Twilio posts delivery receipts back to. This is the *public* URL of this API, which is
  # also the URL Twilio signs its webhook against — see Webhooks::TwilioStatusController.
  config.x.sms.api_url = (required_in_production.call("API_URL") || "http://localhost:3000").chomp("/")

  config.x.twilio.account_sid = required_in_production.call("TWILIO_ACCOUNT_SID") || "AC00000000000000000000000000000000"
  config.x.twilio.auth_token = required_in_production.call("TWILIO_AUTH_TOKEN") || "development_auth_token"
  # Twilio's magic test number. Paired with a test credential it exercises the whole API and
  # delivers nothing.
  config.x.twilio.from_number = required_in_production.call("TWILIO_FROM_NUMBER") || "+15005550006"
end
