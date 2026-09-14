module Api
  # POST /api/sign_ins — the top of the funnel, and the only endpoint on this API that is not about
  # a house.
  #
  # A user who signs in with WorkOS and then abandons /setup never reaches an authenticated endpoint,
  # so today they leave no trace at all: the first step of the conversion funnel is the one step we
  # cannot see, and it cannot be backfilled later from anything we store. Next.js calls this from the
  # AuthKit callback, with the same WorkOS-signed token it forwards everywhere else, and that closes
  # the gap.
  #
  # It deliberately does NOT inherit Api::BaseController. That base means two things — a verified
  # token AND a tenant to scope every query through — and this endpoint can honour only the first:
  # `org_id` is optional here precisely because "signed in, has no house yet" is the fact worth
  # recording. So this is its own front door, beside Authenticatable (house admins),
  # MemberAuthenticatable (housemates) and SuperAdminAuthenticatable (the operator), carrying its own
  # copy of the bearer-token rule for the same reason they each carry one: none of them can be
  # changed by an edit aimed at another.
  #
  # Nothing here is tenant-scoped, and nothing here creates a group. The only rows it can write are
  # the caller's own `users` row and one `sign_ins` row naming it.
  class SignInsController < ApplicationController
    include ApiErrorRendering

    before_action :authenticate_sign_in!

    def create
      user = User.provision!(@claims)

      # An AuthKit access token carries no email and no name unless the WorkOS JWT template has been
      # configured to add them, so a user provisioned from claims alone is a placeholder address and
      # a null name — which is exactly what the operator console had to show for the only real admin
      # in production (https://linear.app/bloombase/issue/BLO-1696).
      #
      # The web app is not missing them: `onSuccess` in apps/web/src/app/callback/route.ts is handed
      # the authenticated WorkOS user object, email and all, and forwards the three fields here in
      # the body of this same request. So the identity reaches the row without Rails calling WorkOS
      # on any path, and without the JWT template having to change.
      #
      # The body is the caller's word, not WorkOS's signature, which is why this only ever fills a
      # gap — see User#absorb_workos_identity!, where that rule lives and is tested.
      user.absorb_workos_identity!(WorkosIdentity.from_params(params))

      # Signing in IS being seen, and for the person this endpoint exists for — the one who signs
      # in and abandons /setup — it is the ONLY time we ever see them. Without this line their
      # `last_seen_at` reads "never" on every super admin surface that shows the column, which is
      # exactly backwards for the people the funnel is about. Same throttled helper as the two read
      # paths (see LastSeen), so a burst of retried callbacks still costs one UPDATE an hour.
      user.touch_last_seen

      SignIn.create!(user: user, workos_organization_id: @claims.workos_organization_id, jti: @claims.jti)

      head :no_content
    rescue ActiveRecord::RecordNotUnique
      # The unique index on `jti` did its job: this exact token has already been recorded, so the
      # callback is being retried — by a re-request, a double-submit, or Next.js retrying us — and
      # a retry of a sign-in is not a second sign-in. Answer as though we had just written it.
      #
      # That holds for as long as tokens carry a `jti`, which is what the unique index keys on — and
      # a token minted without one cannot be deduplicated at all, because Postgres lets NULLs repeat.
      # Nothing here has confirmed what a real AuthKit token carries, so the row count one token can
      # write is floored by a throttle as well (see config/initializers/rack_attack.rb) rather than
      # by this index alone.
      head :no_content
    end

    private

    # The house path's authentication, minus the one thing this endpoint cannot ask for. The token
    # is verified exactly as it is everywhere else — same signature, same issuer, same audience,
    # same expiry — and only `org_id` is allowed to be absent (BLO-1669 added the flag for the
    # operator path; this is its second, and last, caller).
    def authenticate_sign_in!
      @claims = WorkosAccessToken.verify!(bearer_token, allow_missing_organization: true)
    rescue WorkosAccessToken::InvalidToken => e
      # The reason a token was refused belongs in our log, not in a response — told which of the
      # signature, the issuer, the audience or the expiry it failed, an attacker is being given a
      # tutorial.
      logger.info("Refused token: #{e.message}")
      render json: { error: "unauthorized" }, status: :unauthorized
    rescue WorkosAccessToken::KeySetUnavailable => e
      # We could not reach WorkOS, so we do not know whether this token is good. Our outage, said
      # plainly, exactly as the other front doors say it.
      logger.error("WorkOS key set unavailable: #{e.message}")
      render json: { error: "service_unavailable" }, status: :service_unavailable
    end

    # Only the header. Never a query param — Rails' filter_parameters redacts params in logs but a
    # token that arrives in the URL has already been written to the access log by then.
    def bearer_token
      request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
    end
  end
end
