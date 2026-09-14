# Every authenticated request enters the app through here.
#
# Next.js holds the AuthKit session and forwards WorkOS's short-lived, WorkOS-signed access token
# as `Authorization: Bearer <jwt>`. Rails verifies it and provisions from what it says. There is no
# session, no cookie, and no call to WorkOS: a token that verifies is the whole of the evidence.
module Authenticatable
  extend ActiveSupport::Concern

  included do
    before_action :authenticate!

    # Runs after provisioning, because until the token has been turned into a group there is no
    # house to ask whether it is paused. A controller that legitimately answers a paused house —
    # today only Api::MeController — opts out with `skip_before_action :refuse_suspended_group`.
    before_action :refuse_suspended_group

    # And the touch runs after the refusal, deliberately: see #record_last_seen.
    before_action :record_last_seen
  end

  private

  def authenticate!
    claims = WorkosAccessToken.verify!(bearer_token)

    # The authorization seam. Any authenticated member of a WorkOS organization may administer that
    # organization's own group: a household has no admin tiers, and the boundary that actually
    # protects people — a token can only ever act within its own group's tenant (see TenantScoped) —
    # is enforced and tested regardless of role. If we ever add admin tiers, gate the role HERE
    # (e.g. `raise WorkosAccessToken::InvalidToken, "role too low" unless claims.role.in?(...)`);
    # it is a one-line change at one point, not a re-plumb. WorkOS remains the source of the role.
    Current.group_admin = GroupAdmin.provision!(claims)
  rescue WorkosAccessToken::InvalidToken => e
    # The reason a token was refused belongs in our log, not in a response: told which of the
    # signature, the issuer, the audience or the expiry it failed, an attacker is being given a
    # tutorial. The client is told it is not authorized, and nothing else.
    logger.info("Refused token: #{e.message}")
    render json: { error: "unauthorized" }, status: :unauthorized
  rescue WorkosAccessToken::KeySetUnavailable => e
    # We could not reach WorkOS, so we do not know whether this token is good. 401 would be a lie
    # that logs every admin out of the app; 503 says what is true, and Next.js can retry.
    logger.error("WorkOS key set unavailable: #{e.message}")
    # Every admin in every house is locked out for as long as this lasts, and nothing else in the
    # system will notice: the log line says so to whoever is already reading the log. Reported on
    # every refused request on purpose. Sentry groups them into one issue, and the project rate limit
    # is what bounds the cost of an outage; throttling it here would only make the first minute of a
    # real outage look like a blip.
    Rails.error.report(e, handled: true, severity: :warning, source: "rotamonster.workos")
    render json: { error: "service_unavailable" }, status: :service_unavailable
  end

  # The house's own admin API, while an operator has the house paused (BLO-1675).
  #
  # 403 and not 404, which is the opposite of the rule everywhere else on this API — and deliberately
  # so. TenantScoped answers 404 because the caller is not entitled to know the record exists; here
  # they are its admin, the house is theirs, and "this is paused" is the true and useful answer. The
  # code is what the web app switches on to render the paused screen rather than a toast.
  #
  # The provisioning above has already run, which is intended: a paused house still keeps its admin
  # rows in step with WorkOS, so resuming it does not leave a stale role behind. Nothing else about
  # the request proceeds.
  def refuse_suspended_group
    return unless Current.group&.suspended?

    render json: { error: "group_suspended" }, status: :forbidden
  end

  # When we last heard from this admin, for the super admin dashboards (BLO-1671). Throttled to at
  # most one UPDATE an hour so it does not undo the zero-writes steady state that GroupAdmin's
  # provisioning goes to such trouble for — see LastSeen, which is the whole of the rule, shared
  # with the member path.
  #
  # Ordered AFTER the suspension refusal, and guarded again here, because a paused house's clock
  # must stop (BLO-1675). The operator's list renders "last activity" on a paused row, and a house
  # whose admins keep loading the paused screen would go on looking busier by the hour while
  # nothing at all was happening in it. The second guard is not belt-and-braces: /api/me is exempt
  # from the refusal above, and it is precisely the endpoint the paused screen polls.
  def record_last_seen
    return if Current.group&.suspended?

    Current.user.touch_last_seen
  end

  # Only the header. Never a query param — Rails' filter_parameters redacts params in logs but a
  # token that arrives in the URL has already been written to the access log by then.
  def bearer_token
    request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
  end
end
