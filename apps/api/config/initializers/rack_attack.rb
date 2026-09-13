# Rate limiting for the member magic-link path.
#
# The member token is a permanent, non-expiring credential, so the attack that matters is
# enumeration: hammering /api/member/* with guessed tokens hoping one resolves to a member. A
# 32-byte URL-safe token is not guessable, but a throttle turns "computationally infeasible" into
# "also rate-limited".
#
# The subtlety is WHO to key on. A household shares one public Wi-Fi IP, and a reminder or
# cover-notice blast makes everyone tap their link inside the same minute — so a per-IP throttle
# would let a big house 429 itself during exactly the intended-use spike. So authenticated members
# are keyed per MEMBER (each person gets their own bucket, and the shared IP is irrelevant), and only
# UNAUTHENTICATED traffic — no token, or a token that resolves to no active member, i.e. the
# enumeration surface — is keyed per IP.
#
# Scoped to /api/member/* ONLY, on purpose. The admin path is gated by WorkOS JWT verification; the
# Twilio webhook fails closed on its signature and touches no row before the check.
class Rack::Attack
  MEMBER_PATH_PREFIX = "/api/member/"

  # The two admin routes that make the server fetch a third-party URL on the caller's behalf
  # (BLO-1667). PATCH is here because the router generates it alongside PUT for a singular resource,
  # and a limit a second verb walks around is not a limit.
  CALENDAR_CONNECT_PATH = "/api/group/calendar"
  CALENDAR_SYNC_PATH = "/api/group/calendar/sync"

  # Authenticated members: keyed per member, generously. Bounds a single runaway or compromised token
  # without ever punishing a housemate for who else is on their Wi-Fi.
  throttle("member_api/member", limit: 60, period: 60.seconds) do |request|
    Rack::Attack.member_id_for(request) if request.path.start_with?(MEMBER_PATH_PREFIX)
  end

  # Everyone else on the member path — no token, or a token that resolves to nobody. This is the
  # enumeration path; key it on IP and keep the limit tight.
  throttle("member_api/enumeration", limit: 30, period: 60.seconds) do |request|
    next unless request.path.start_with?(MEMBER_PATH_PREFIX)

    request.ip if Rack::Attack.member_id_for(request).nil?
  end

  # Connecting a house calendar or pressing "Sync now" makes the server download someone else's URL,
  # which is the one thing on the admin API worth putting in a loop. Five a minute is generous for a
  # human and a hard stop for a script, and the first four of those five are already more calendar
  # than Google will have re-cached.
  #
  # Keyed on the bearer token rather than the IP, for the same reason the member throttle is keyed
  # per member: two houses behind one office or café NAT share an IP, and one of them syncing must
  # never lock the other out. The token is hashed because the key is written to the cache store and
  # a WorkOS access token is a credential, and the digest tells two callers apart without keeping one.
  # A token refresh therefore starts a fresh bucket; a WorkOS access token lives minutes, which is
  # long enough for this window to mean something.
  throttle("group_api/calendar_fetch", limit: 5, period: 60.seconds) do |request|
    Rack::Attack.calendar_caller_for(request) if Rack::Attack.calendar_fetch?(request)
  end

  # A throttled caller gets JSON, like every other error on this API, rather than Rack::Attack's
  # default text body.
  self.throttled_responder = lambda do |_request|
    [ 429, { "Content-Type" => "application/json" }, [ { error: "too_many_requests" }.to_json ] ]
  end

  # Does this request make the server go and download a calendar?
  #
  # The comparison is against the NORMALISED path, not `request.path`. Rails routes `(.:format)` and
  # any number of trailing slashes to the same action, so `/api/group/calendar/sync.json` and
  # `/api/group/calendar/sync/` both reach #sync while being unequal to the route as written. A
  # throttle matching the raw string is therefore five characters away from not existing, and what
  # it would be failing to limit is a 5 MB third-party download and a paid model call. Prefix
  # matching, as the two member throttles use, would have been immune for the same reason.
  def self.calendar_fetch?(request)
    path = normalised_path(request.path)
    (request.post? && path == CALENDAR_SYNC_PATH) ||
      ((request.put? || request.patch?) && path == CALENDAR_CONNECT_PATH)
  end

  # Trailing slashes first, then a format suffix: `/sync.json/` is a real spelling of `/sync`, and
  # stripping in the other order would leave the dot behind. Neither calendar path contains a dot,
  # so there is nothing here for the format pattern to eat by mistake.
  def self.normalised_path(path)
    path.sub(%r{/+\z}, "").sub(/\.[a-z0-9]+\z/i, "")
  end

  # Who is asking, as far as a throttle needs to know. A request with no Authorization header has
  # nothing to tell it apart by but its IP, and is about to be refused by JWT verification anyway.
  def self.calendar_caller_for(request)
    authorization = request.env["HTTP_AUTHORIZATION"].to_s
    return "ip:#{request.ip}" if authorization.blank?

    "token:#{OpenSSL::Digest::SHA256.hexdigest(authorization)}"
  end

  # The member a request's bearer token names, resolved once and memoised on the Rack env so the two
  # member throttles share ONE indexed lookup. Only ACTIVE members resolve, so a deactivated token
  # authenticates as nobody (see MemberAuthenticatable), so it falls to the IP throttle like any other
  # bad token. A token-less request never touches the database.
  def self.member_id_for(request)
    request.env.fetch("member_api.member_id") do
      token = request.env["HTTP_AUTHORIZATION"].to_s[/\ABearer\s+(.+)\z/i, 1]
      request.env["member_api.member_id"] =
        token.present? ? Member.active.where(access_token: token).pick(:id) : nil
    end
  end
end

Rails.application.config.middleware.use Rack::Attack
