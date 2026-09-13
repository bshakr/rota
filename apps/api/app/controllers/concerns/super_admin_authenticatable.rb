# The operator's way in — a third, deliberately separate front door, beside Authenticatable (house
# admins) and MemberAuthenticatable (housemates).
#
# It verifies the same WorkOS-signed token the house path does, with two differences, and both are
# the point:
#
#   * `org_id` may be missing. An operator may belong to no house at all, and there is nothing here
#     to scope them to anyway — see SuperAdmin::BaseController, which is deliberately not
#     TenantScoped.
#   * The verified `sub` must be on the boot-resolved allowlist. WorkOS says who you are; the
#     allowlist, and only the allowlist, says whether you are the operator.
#
# Nothing here provisions. The house path rebuilds users, groups and group_admins from the token on
# every request; a super admin request must leave the database exactly as it found it, so that a
# caller who is refused cannot have written a row on the way past.
module SuperAdminAuthenticatable
  extend ActiveSupport::Concern

  included do
    before_action :authenticate_super_admin!
  end

  private

  def authenticate_super_admin!
    claims = WorkosAccessToken.verify!(bearer_token, allow_missing_organization: true)

    return refuse_super_admin(claims.workos_user_id) unless SuperAdminAllowlist.allows?(claims.workos_user_id)

    Current.super_admin_workos_user_id = claims.workos_user_id

    # Every super admin action reaches across houses, so the log has to be able to name the human
    # who took it. The WorkOS user id is the only durable name we have for them here.
    logger.info("Super admin request by #{claims.workos_user_id}")
  rescue WorkosAccessToken::InvalidToken => e
    # 401, not the 404 an unauthorized caller gets: a token that does not verify is refused the
    # same way it is refused everywhere else on this API, which is what tells the web app to
    # refresh an expired session rather than render "not found" at an operator who is simply
    # stale. What the 404 below hides is *who is on the allowlist* — and that is intact, because
    # reaching it at all requires a token that already verified.
    logger.info("Refused token: #{e.message}")
    render json: { error: "unauthorized" }, status: :unauthorized
  rescue WorkosAccessToken::KeySetUnavailable => e
    # We could not reach WorkOS, so we do not know whether this token is good. Our outage, said
    # plainly, exactly as the house path says it.
    logger.error("WorkOS key set unavailable: #{e.message}")
    render json: { error: "service_unavailable" }, status: :service_unavailable
  end

  # 404, never 403. This matches the tenancy rule (see TenantScoped#not_found): a surface you are
  # not allowed to use should be indistinguishable from one that does not exist. A 403 would
  # confirm to any house admin who guessed the path that there is an operator console here and
  # that they are simply not on the list — an invitation to go looking for whoever is.
  def refuse_super_admin(workos_user_id)
    logger.info("Refused super admin: #{workos_user_id.inspect} is not in SUPER_ADMIN_WORKOS_USER_IDS")
    render json: { error: "not_found" }, status: :not_found
  end

  # Only the header, and only the bearer scheme — the same rule, and the same reason, as the other
  # two authentication concerns: Rails' filter_parameters redacts params in logs, but a token that
  # arrives in the URL has already been written to the access log by then. Each front door carries
  # its own copy rather than sharing one, so none of them can be changed by a edit aimed at another.
  def bearer_token
    request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
  end
end
