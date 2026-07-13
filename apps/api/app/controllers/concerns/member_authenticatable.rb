# The member magic-link path's authentication — a second, deliberately narrow way in.
#
# Members have no WorkOS identity. Their magic link carries an opaque 32-byte URL-safe token that
# maps to exactly one member record, and that token IS the identity: a request that resolves to a
# member is believed to be that member. There is no session and no JWT. What keeps this safe to hand
# out over SMS is how little it can reach — one member's own shifts, and the cover action, nothing
# else — see Api::MemberBaseController.
#
# The token only ever arrives in the Authorization header, NEVER as a path segment. Rails'
# filter_parameters redacts query strings and bodies but not `filtered_path`, which is logged at info
# on every request; a permanent, non-expiring credential written there in plaintext would hand every
# member's login to anyone with log-read access. The header falls inside the filter that already
# exists. spec/requests/api/member/token_privacy_spec proves it cannot regress.
module MemberAuthenticatable
  extend ActiveSupport::Concern

  included do
    before_action :authenticate_member!
  end

  private

  def authenticate_member!
    @current_member = Member.find_by(access_token: bearer_token) if bearer_token.present?

    return if @current_member

    # No detail about why: an unknown token and a malformed header are both simply "not authorized".
    render json: { error: "unauthorized" }, status: :unauthorized
  end

  attr_reader :current_member

  # Only the header, and only the bearer scheme. A token in the query string would already be in the
  # access log by the time any filter ran.
  def bearer_token
    request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
  end
end
