# Rate limiting for the member magic-link path.
#
# The member token is a permanent, non-expiring credential, so the attack that matters is
# enumeration: hammering /api/member/* with guessed tokens hoping one resolves to a member. A
# 32-byte URL-safe token is not guessable, but a throttle turns "computationally infeasible" into
# "also rate-limited", and stops a flood of bad tokens from becoming a load problem before it ever
# reaches the database.
#
# Scoped to /api/member/* ONLY, and on purpose. The admin path is already gated by WorkOS JWT
# verification; a throttle there would rate-limit a legitimate, signed-in dashboard. The Twilio
# webhook fails closed on its signature and touches no row before the check, so it needs none either.
class Rack::Attack
  # Per IP. Generous for a human opening their link and tapping through a cover; tight for a script
  # walking the token space. Counting needs a real cache store: in production that is Solid Cache; in
  # test the store is null (so this never interferes with other specs) and the throttle spec swaps in
  # a MemoryStore to exercise the limit.
  throttle("member_api/ip", limit: 30, period: 60.seconds) do |request|
    request.ip if request.path.start_with?("/api/member/")
  end

  # A throttled caller gets JSON, like every other error on this API, rather than Rack::Attack's
  # default text body.
  self.throttled_responder = lambda do |_request|
    [ 429, { "Content-Type" => "application/json" }, [ { error: "too_many_requests" }.to_json ] ]
  end
end

Rails.application.config.middleware.use Rack::Attack
