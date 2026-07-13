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
    Current.group_admin = GroupAdmin.provision!(WorkosAccessToken.verify!(bearer_token))
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
