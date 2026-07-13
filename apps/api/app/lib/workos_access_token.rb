# The security boundary of the product.
#
# Rails is stateless: it never asks WorkOS whether a session is real. Everything it believes about
# a request — who is asking, and which house they are asking about — comes out of this file, and
# nothing that has not been through `verify!` is believed at all. In particular `org_id` is a
# signed claim, never a param, a header or a path segment: that is what stops one house reading
# another's rota.
class WorkosAccessToken
  # The token is not one we will act on. The caller gets a 401 and no explanation.
  class InvalidToken < StandardError; end

  # We could not reach WorkOS to find out whether the token is good. That is our outage, not the
  # caller's fault, and it must not be reported as "your token is bad" — a 401 would log every
  # admin out of the app for the duration.
  class KeySetUnavailable < StandardError; end

  # What a verified token tells us. Nothing else in the app touches the raw claim hash, so there
  # is exactly one place where a string from the internet becomes something we act on.
  Claims = Data.define(:workos_user_id, :workos_organization_id, :role, :email, :name)

  ALGORITHM = "RS256"

  # WorkOS rotates its signing keys rarely, and refetching the key set per request would put a
  # network round trip in front of every API call and make the whole API unavailable whenever
  # WorkOS is. So the key set is held in the process. A rotation is picked up by the unknown-kid
  # path below rather than by waiting this out.
  CACHE_TTL = 12.hours

  # A token naming a kid we have never seen is either a rotation we have not noticed yet, or
  # somebody feeding us junk kids to make us hammer WorkOS on their behalf. It gets to force a
  # refetch, but no more often than this.
  REFETCH_FLOOR = 10.seconds

  # HTTP timeouts. WorkOS being slow must not become Puma being out of threads.
  OPEN_TIMEOUT = 2
  READ_TIMEOUT = 3

  @mutex = Mutex.new

  class << self
    # Returns the verified Claims, or raises. This is the only entry point.
    def verify!(token)
      raise InvalidToken, "no bearer token" if token.blank?

      payload, = JWT.decode(token, nil, true, algorithms: [ ALGORITHM ], jwks: key_set_loader)

      verify_issuer!(payload["iss"])
      verify_audience!(payload["aud"])

      claims(payload)
    rescue JWT::DecodeError => e
      # Covers a bad signature, an expired token, an unknown kid, `alg: none`, and a token that is
      # not a JWT at all.
      raise InvalidToken, "#{e.class}: #{e.message}"
    end

    def reset_key_set!
      @mutex.synchronize do
        @key_set = nil
        @fetched_at = nil
      end
    end

    private

    def claims(payload)
      # No org_id means the admin has not selected an organization, so there is no tenant to scope
      # them to and nothing they could be allowed to do. There is no "global" request in this API.
      organization_id = payload["org_id"].presence
      raise InvalidToken, "token names no organization" if organization_id.nil?

      Claims.new(
        workos_user_id: payload.fetch("sub").presence || raise(InvalidToken, "token names no subject"),
        workos_organization_id: organization_id,
        # WorkOS owns the role vocabulary. A token from an org with no role configured still names
        # a member of that org.
        role: payload["role"].presence || "member",
        # Neither of these is a standard AuthKit claim; they arrive only if the WorkOS JWT template
        # is configured to add them. See GroupAdmin.provision! for what happens when they are not.
        email: payload["email"].presence,
        name: payload["name"].presence
      )
    rescue KeyError
      raise InvalidToken, "token names no subject"
    end

    # The signature is the real binding to our WorkOS environment: the key set is published per
    # client id, so a key that is not in *our* JWKS can claim any org_id it likes and be worthless.
    # The issuer check is the belt to that pair of braces.
    def verify_issuer!(issuer)
      raise InvalidToken, "issuer #{issuer.inspect} is not trusted" unless trusted_issuer?(issuer)
    end

    def trusted_issuer?(issuer)
      return false if issuer.blank?
      return issuer == pinned_issuer if pinned_issuer.present?

      uri = URI.parse(issuer)
      return false unless "#{uri.scheme}://#{uri.host}" == api_origin

      # WorkOS documents both `https://api.workos.com/user_management/<client_id>` and a bare
      # `https://api.workos.com/`. Accept either — but if the issuer names a client, it must name
      # ours, so a token minted for somebody else's WorkOS client is refused even in the (unlikely)
      # event that it verifies against our key set.
      path = uri.path.to_s.delete_suffix("/")
      path.empty? || path == "/user_management/#{client_id}"
    rescue URI::InvalidURIError
      false
    end

    # An AuthKit access token carries no `aud` at all, so this cannot be "aud must be present" —
    # that would refuse every real token. What it defends is the case the claim exists for: a
    # token WorkOS minted for a *different* audience (another OAuth application in the same WorkOS
    # environment, signed by the very same keys). Presenting that here would make this API a
    # confused deputy for whatever that application is.
    def verify_audience!(audience)
      return if audience.blank?
      return if Array(audience).include?(client_id)

      raise InvalidToken, "audience #{audience.inspect} is not this app"
    end

    # jwt calls this to find the key that signed the token, and calls it a second time with
    # `invalidate: true` if the token's kid was not in what we handed over.
    def key_set_loader
      ->(options) { key_set(refetch: options[:invalidate]) }
    end

    def key_set(refetch: false)
      @mutex.synchronize do
        return @key_set if @key_set && fresh_enough?(refetch: refetch)

        @key_set = fetch_key_set
        @fetched_at = Time.current
        @key_set
      end
    end

    def fresh_enough?(refetch:)
      return @fetched_at > REFETCH_FLOOR.ago if refetch

      @fetched_at > CACHE_TTL.ago
    end

    def fetch_key_set
      raise KeySetUnavailable, "WORKOS_CLIENT_ID is not set, so there is no key set to fetch" if jwks_url.blank?

      uri = URI(jwks_url)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
        open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) do |http|
        http.get(uri.request_uri)
      end

      raise KeySetUnavailable, "JWKS fetch returned #{response.code}" unless response.is_a?(Net::HTTPSuccess)

      JWT::JWK::Set.new(JSON.parse(response.body)).tap do |keys|
        raise KeySetUnavailable, "JWKS is empty" if keys.none?
      end
    rescue JSON::ParserError, JWT::JWKError, Timeout::Error, SocketError, SystemCallError, IOError,
           OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError => e
      # Nothing is cached on this path, so the next request tries again rather than being stuck
      # with a failure until the TTL runs out.
      raise KeySetUnavailable, "JWKS fetch failed: #{e.class}: #{e.message}"
    end

    def client_id = Rails.application.config.x.workos.client_id
    def jwks_url = Rails.application.config.x.workos.jwks_url
    def api_origin = Rails.application.config.x.workos.api_origin
    def pinned_issuer = Rails.application.config.x.workos.issuer
  end
end
