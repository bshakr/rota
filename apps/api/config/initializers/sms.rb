# Everything the outbound SMS path needs, resolved once, at boot.
#
# The rules live in the SmsBoot module below rather than in the config block so they can be tested
# without booting a production environment — the module is defined at load time and stays available
# to specs. It is a top-level constant rather than app code under Sms:: because an initializer runs
# before the app autoloader will resolve reloadable constants, and this must run at boot.
#
# The principle: development and test boot and run the whole send path with no Twilio account, while
# production refuses to boot the moment it is misconfigured — a misconfigured SMS path fails
# silently, and a silent SMS path is the one failure this system cannot tolerate.
module SmsBoot
  module_function

  # :twilio really talks to Twilio; :null logs and invents a SID. Development defaults to :null so a
  # developer cannot text anybody; everything else defaults to :twilio so the specs and production
  # exercise the real client (WebMock stops the network in test).
  def adapter_for(env:, requested:)
    adapter = requested.presence || (env.development? ? "null" : "twilio")

    # A null adapter in production means every reminder "succeeds" and nobody is ever texted. Refuse
    # to boot rather than discover that from an empty SMS log.
    if env.production? && adapter == "null"
      raise "SMS_ADAPTER=null in production would silently text nobody."
    end

    adapter
  end

  # The operator's alert number (SIGNUP_ALERT_PHONE), normalised to E.164, or nil when nobody is to
  # be told. See NewSignupAlertJob.
  #
  # Optional in every environment, production included, and that is deliberate: "no operator wants a
  # text when somebody signs up" is a supported answer, so an unset variable means no job is ever
  # enqueued rather than a job that fails. But a variable that IS set and does not parse is the
  # worst of both. The alert never arrives and nothing says why, discovered weeks later from an
  # empty inbox. So a value that is present must be dialable, and it must be dialable at boot,
  # which is the same argument the credentials above make.
  #
  # Normalised the way Member#normalise_phone normalises a housemate's number, and for the same
  # reason: an operator types "07911 123456", and libphonenumber judges that national form invalid
  # while judging the identical number valid as "+447911123456". Parse with the default country
  # first, then judge the E.164 form, because the two steps are not interchangeable.
  def signup_alert_phone_for(value)
    return nil if value.blank?

    e164 = Phonelib.parse(value, Phonelib.default_country).e164
    return e164 if e164.present? && Phonelib.parse(e164).valid?

    raise "SIGNUP_ALERT_PHONE is not a phone number we could dial. Set it in international form, " \
      "e.g. +447911123456, or leave it unset to send no signup alerts at all."
  end

  # In production a missing credential is not a default to paper over — it is the difference between
  # a text arriving and a text going nowhere. Say so at boot. Everywhere else, fall back to the
  # caller's development default so the app still boots with no account.
  def require_in_production(name, value, env:)
    return value if value.present?
    return nil unless env.production?

    raise "#{name} must be set in production. The SMS path cannot be guessed at."
  end
end

Rails.application.configure do
  env = Rails.env

  # See SmsBoot.adapter_for. Development -> null (nobody gets a 3am text while you debug); test ->
  # twilio on purpose (the specs must exercise the real client, with WebMock stopping the network);
  # production -> twilio, and it refuses to boot with SMS_ADAPTER=null.
  config.x.sms.adapter = SmsBoot.adapter_for(env: env, requested: ENV["SMS_ADAPTER"])

  # Baked into every magic link we send. A text is permanent in a way a deploy is not: a link
  # pointing at a dead host cannot be recalled, so this is read from config and never hardcoded.
  config.x.sms.app_url =
    (SmsBoot.require_in_production("APP_URL", ENV["APP_URL"], env: env) || "http://localhost:3001").chomp("/")

  # Where Twilio posts delivery receipts. This is the *public* URL of this API, which is also the
  # URL Twilio signs its webhook against — see Webhooks::TwilioStatusController.
  config.x.sms.api_url =
    (SmsBoot.require_in_production("API_URL", ENV["API_URL"], env: env) || "http://localhost:3000").chomp("/")

  # Who to text when a brand new admin signs up (see NewSignupAlertJob). Nil unless
  # SIGNUP_ALERT_PHONE is set, and nil means the whole feature is off: User's after_create_commit
  # checks this before it enqueues anything, so an operator who wants no such text pays for no job.
  config.x.sms.signup_alert_phone = SmsBoot.signup_alert_phone_for(ENV["SIGNUP_ALERT_PHONE"])

  config.x.twilio.account_sid =
    SmsBoot.require_in_production("TWILIO_ACCOUNT_SID", ENV["TWILIO_ACCOUNT_SID"], env: env) ||
    "AC00000000000000000000000000000000"
  config.x.twilio.auth_token =
    SmsBoot.require_in_production("TWILIO_AUTH_TOKEN", ENV["TWILIO_AUTH_TOKEN"], env: env) ||
    "development_auth_token"
  # Twilio's magic test number. Paired with a test credential it exercises the whole API and
  # delivers nothing.
  config.x.twilio.from_number =
    SmsBoot.require_in_production("TWILIO_FROM_NUMBER", ENV["TWILIO_FROM_NUMBER"], env: env) ||
    "+15005550006"
end
