# Everything the suite needs to hold a WorkOS-signed token.
#
# No spec may reach the real JWKS endpoint — WebMock forbids it — so the suite mints its own
# RSA key, serves the matching public key from a stubbed JWKS, and signs its own tokens with it.
# That is the whole trick: the app cannot tell these tokens from WorkOS's, because the only thing
# it ever trusts is "was this signed by a key the JWKS published".
module WorkosAuth
  KID = "houserota-test-key"

  class << self
    # 2048-bit RSA takes ~100ms to generate, so both keys are made once for the whole suite.
    def signing_key
      @signing_key ||= OpenSSL::PKey::RSA.generate(2048)
    end

    # A key WorkOS never published. Tokens signed with it must never verify — that is the
    # "bad signature" case, and it is the one that matters most.
    def foreign_key
      @foreign_key ||= OpenSSL::PKey::RSA.generate(2048)
    end

    def jwks
      { keys: [ JWT::JWK.new(signing_key, kid: KID).export ] }
    end

    def client_id
      Rails.application.config.x.workos.client_id
    end

    def jwks_url
      Rails.application.config.x.workos.jwks_url
    end
  end

  # Registers the JWKS endpoint. Registering is not fetching: a spec can still assert how many
  # times the app actually went and got it.
  def stub_workos_jwks
    stub_request(:get, WorkosAuth.jwks_url)
      .to_return(status: 200, body: WorkosAuth.jwks.to_json, headers: { "Content-Type" => "application/json" })
  end

  # A token shaped exactly like the one AuthKit forwards: WorkOS's own claims, no `aud`, no
  # `email`. Pass `key:` to sign with something WorkOS never published, or any claim by name to
  # corrupt it — `workos_token(exp: 1.hour.ago.to_i)`, `workos_token(org_id: nil)`.
  def workos_token(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin", key: WorkosAuth.signing_key, kid: WorkosAuth::KID, **claims)
    payload = {
      iss: "https://api.workos.com/user_management/#{WorkosAuth.client_id}",
      sub: sub,
      sid: "session_01TEST",
      jti: SecureRandom.uuid,
      org_id: org_id,
      role: role,
      iat: Time.current.to_i,
      exp: 5.minutes.from_now.to_i
    }.merge(claims).compact

    JWT.encode(payload, key, "RS256", kid: kid)
  end

  def workos_headers(...)
    { "Authorization" => "Bearer #{workos_token(...)}" }
  end

  # Returns the INSERT/UPDATE/DELETE statements Active Record ran during the block. Used to prove
  # the steady-state authenticated read path writes nothing. BEGIN/COMMIT/SAVEPOINT and SELECTs
  # are ignored — only actual row mutations count.
  def sql_writes_during
    statements = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
      statements << payload[:sql] if payload[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE)\b/i)
    end
    yield
    statements
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end
end

RSpec.configure do |config|
  config.include WorkosAuth

  config.before do
    # The key set is cached in the process and would otherwise leak across examples, which is
    # exactly what the "fetched once" spec is trying to measure.
    WorkosAccessToken.reset_key_set!

    # Current is reset by Rails around a real request. Controller specs do not run that middleware,
    # so an example could otherwise start life inside the previous example's group.
    Current.reset

    stub_workos_jwks
  end
end
