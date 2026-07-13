# Every authenticated request enters the app through here.
#
# Next.js holds the AuthKit session and forwards WorkOS's short-lived, WorkOS-signed access token
# as `Authorization: Bearer <jwt>`. Rails verifies it and provisions from what it says. There is no
# session, no cookie, and no call to WorkOS: a token that verifies is the whole of the evidence.
module Authenticatable
  extend ActiveSupport::Concern

  included do
    before_action :authenticate!
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
    render json: { error: "service_unavailable" }, status: :service_unavailable
  end

  # Only the header. Never a query param — Rails' filter_parameters redacts params in logs but a
  # token that arrives in the URL has already been written to the access log by then.
  def bearer_token
    request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
  end
end
