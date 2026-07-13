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

  # Stale-if-error. WorkOS rotates keys rarely, so a cached key set is almost certainly still valid
  # even after the TTL. If a post-TTL refresh fails because WorkOS is unreachable, we keep serving
  # the stale set rather than 503-ing every request — a WorkOS blip must not log the whole app out.
  # This is how long we serve stale before trying WorkOS again, so an outage costs one fetch attempt
  # per window rather than one per request.
  STALE_RETRY_BACKOFF = 30.seconds

  # A little slack on the expiry check. Rails' clock and WorkOS's are not perfectly aligned, and
  # without leeway a token a second from expiry is refused over skew alone.
  EXP_LEEWAY = 30

  # HTTP timeouts. WorkOS being slow must not become Puma being out of threads.
  OPEN_TIMEOUT = 2
  READ_TIMEOUT = 3

  # Two locks on purpose. @state_mutex guards the cached key set and is only ever held for O(1)
  # reads and the pointer swap — never across the network. @fetch_mutex serialises the actual
  # HTTP fetch so a rotation storm makes one request to WorkOS, not one per thread (single-flight).
  # The split is the whole point: a slow or hung JWKS response can only ever block another thread
  # that also needs to fetch; it can NEVER block the cache-hit readers, which are every normal
  # authenticated request.
  @state_mutex = Mutex.new
  @fetch_mutex = Mutex.new

  class << self
    # Returns the verified Claims, or raises. This is the only entry point on the request path.
    def verify!(token)
      raise InvalidToken, "no bearer token" if token.blank?

      payload, = JWT.decode(token, nil, true,
        algorithms: [ ALGORITHM ], jwks: key_set_loader, exp_leeway: EXP_LEEWAY)

      verify_issuer!(payload["iss"])
      verify_audience!(payload["aud"])

      claims(payload)
    rescue JWT::DecodeError => e
      # Covers a bad signature, an expired token, an unknown kid, `alg: none`, and a token that is
      # not a JWT at all.
      raise InvalidToken, "#{e.class}: #{e.message}"
    end

    # Operational tooling only — never called on a request. Verifies the signature and expiry
    # against the live JWKS and returns the FULL header and claim set, plus whether the issuer and
    # audience checks would pass, so a human wiring real WorkOS keys (BLO-1057) can see exactly what
    # a real token carries — settling the `aud`/issuer ambiguity from a real token, not from docs.
    # See lib/tasks/workos.rake.
    def inspect_claims(token)
      payload, header = JWT.decode(token, nil, true, algorithms: [ ALGORITHM ], jwks: key_set_loader)

      {
        header: header,
        payload: payload,
        issuer_trusted: trusted_issuer?(payload["iss"]),
        audience_accepted: audience_accepted?(payload["aud"])
      }
    end

    def reset_key_set!
      @state_mutex.synchronize do
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

      # WorkOS documents the issuer both as `https://api.workos.com/user_management/<client_id>`
      # and as a bare `https://api.workos.com/`. The client-scoped form is always accepted, and it
      # must name OUR client — a token minted for somebody else's WorkOS client is refused even in
      # the unlikely event it verifies against our key set.
      path = uri.path.to_s.delete_suffix("/")
      return true if path == "/user_management/#{client_id}"

      # The bare form does not name a client, so accepting it leaves cross-client isolation resting
      # entirely on WorkOS serving per-client keys. That is a fine dev convenience but not a
      # production assumption: in production we require the client-scoped form, or an exact
      # WORKOS_JWT_ISSUER pin (handled above). BLO-1057 confirms the real format before launch.
      path.empty? && !Rails.env.production?
    rescue URI::InvalidURIError
      false
    end

    # An AuthKit access token carries no `aud` at all, so this cannot be "aud must be present" —
    # that would refuse every real token. What it defends is the case the claim exists for: a
    # token WorkOS minted for a *different* audience (another OAuth application in the same WorkOS
    # environment, signed by the very same keys). Presenting that here would make this API a
    # confused deputy for whatever that application is.
    def verify_audience!(audience)
      raise InvalidToken, "audience #{audience.inspect} is not this app" unless audience_accepted?(audience)
    end

    def audience_accepted?(audience)
      audience.blank? || Array(audience).include?(client_id)
    end

    # jwt calls this to find the key that signed the token, and calls it a second time with
    # `invalidate: true` if the token's kid was not in what we handed over.
    def key_set_loader
      ->(options) { key_set(refetch: options[:invalidate]) }
    end

    def key_set(refetch: false)
      snapshot = nil
      @state_mutex.synchronize do
        return @key_set if @key_set && fresh_enough?(refetch: refetch)

        snapshot = @fetched_at
      end

      # Single-flight: only one thread fetches at a time. Any others wait here — but crucially they
      # are threads that ALSO need a fetch, never cache-hit readers, who never reach this method's
      # network path at all. The re-check inside the lock means a thread that queued behind a fetch
      # usually finds the set already fresh and never hits the network.
      @fetch_mutex.synchronize do
        @state_mutex.synchronize do
          return @key_set if @key_set && (@fetched_at != snapshot) && fresh_enough?(refetch: refetch)
        end

        begin
          fetched = fetch_key_set
        rescue KeySetUnavailable
          # Stale-if-error: the refresh failed, but a cached set from before the TTL is almost
          # certainly still valid, so we serve it rather than fail. Only a cold cache — nothing to
          # fall back on — actually 503s. Back the clock off by one backoff window so requests serve
          # the stale set without hitting the network again until it is worth retrying WorkOS.
          stale = @state_mutex.synchronize { @key_set }
          raise unless stale

          @state_mutex.synchronize { @fetched_at = STALE_RETRY_BACKOFF.from_now - CACHE_TTL }
          return stale
        end

        fetched_at = Time.current
        @state_mutex.synchronize do
          @key_set = fetched
          @fetched_at = fetched_at
          @key_set
        end
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
