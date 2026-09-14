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
    # `active` only: deactivation is how a member is *removed* from a house, and it deliberately does
    # not rotate the token (see Member). Without this scope a removed housemate would keep a fully
    # working magic link — able to read the live roster and act on shifts — which is the exact thing
    # removal is supposed to end. A deactivated token therefore authenticates as nobody: a 401.
    @current_member = Member.active.find_by(access_token: bearer_token) if bearer_token.present?

    if @current_member
      record_last_seen
      record_first_open
      return
    end

    # No detail about why: an unknown token and a malformed header are both simply "not authorized".
    render json: { error: "unauthorized" }, status: :unauthorized
  end

  attr_reader :current_member

  # "Did anyone actually open their link" — the one signal the member path has, and the only way to
  # tell a house whose texts land from one whose housemates never tap them. Same one-an-hour rule as
  # the admin path, and for the same reason: this is a read path.
  #
  # Not while the house is paused (BLO-1675), and the guard is HERE rather than in the controller's
  # own paused response so that it runs before the write and not after it. A paused house's "last
  # activity" must stop moving — the operator's list shows it on a paused row, and a housemate
  # reloading the paused notice is not the house doing anything.
  def record_last_seen
    return if @current_member.group.suspended?

    @current_member.touch_last_seen
  end

  # The moment a housemate's magic link first works. Not a page view: this is the token resolving,
  # which is the only signal that reaches the server whether the link was opened from the text, a
  # bookmark, or a tap on a cover button. It is the last step of the funnel (wave 4c) and it fires
  # exactly once per housemate, ever.
  #
  # Paused houses are skipped, for a sharper reason than the last-seen touch above. A housemate who
  # opens their link while the house is paused sees the paused notice, not their rota — they have not
  # turned up in any sense the funnel means, and stamping `first_opened_at` there would burn the
  # once-ever event on a screen that showed them nothing. Resuming leaves the claim still to make.
  #
  # The claim is a CONDITIONAL UPDATE rather than a read-then-write, so two requests racing off one
  # text (a link preview fetch and the tap behind it, say) can only produce one event: exactly one of
  # them changes a row, and only that one captures. No read-modify-write, no lock, no extra column
  # per event — `first_opened_at` is the timestamp the members table was missing, and it is also what
  # answers "did two housemates open within seven days".
  def record_first_open
    member = @current_member
    return if member.first_opened_at.present?
    return if member.group.suspended?

    now = Time.current
    claimed = Member.where(id: member.id, first_opened_at: nil).update_all(first_opened_at: now, updated_at: now)
    return if claimed.zero?

    member.first_opened_at = now
    AnalyticsEvent.record(AnalyticsEvent::FIRST_MEMBER_LINK_OPENED, group: member.group, member_id: member.id)
  end

  # Only the header, and only the bearer scheme. A token in the query string would already be in the
  # access log by the time any filter ran.
  def bearer_token
    request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
  end
end
