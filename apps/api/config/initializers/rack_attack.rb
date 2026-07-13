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

  # A throttled caller gets JSON, like every other error on this API, rather than Rack::Attack's
  # default text body.
  self.throttled_responder = lambda do |_request|
    [ 429, { "Content-Type" => "application/json" }, [ { error: "too_many_requests" }.to_json ] ]
  end

  # The member a request's bearer token names, resolved once and memoised on the Rack env so the two
  # throttles above share ONE indexed lookup. Only ACTIVE members resolve — a deactivated token
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
