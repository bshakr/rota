module Public
  # Intentionally does not inherit the WorkOS/admin controller. Responses contain
  # household identification only, never member identities or personal-link tokens.
  class HouseholdsController < ApplicationController
    def show
      response.headers["Cache-Control"] = "no-store"
      group = Group.find_by(slug: params[:slug])
      return render json: { error: "not_found" }, status: :not_found unless group

      payload = { household: { name: group.name, slug: group.slug } }
      # Paused by an operator (BLO-1675). 200 and not a 404: the house exists, the person standing
      # in front of this page lives in it, and hiding it would send them looking for a broken link.
      # The key is present only while the house is paused, which is the same rule the member path
      # follows, and the page swaps the phone form for a quiet notice when it sees it.
      payload[:paused] = true if group.suspended?

      render json: payload
    end

    def request_link
      HouseholdEntry.request_link(slug: params[:slug], phone: params[:phone])
      response.headers["Cache-Control"] = "no-store"
      # Same status and payload for unknown houses/numbers, opt-outs, rate limits — and, since
      # BLO-1675, paused houses. HouseholdEntry is where a paused house stops being found; keeping
      # the refusal there rather than here is what preserves the one property this endpoint has,
      # which is that its answer says nothing about the house or the number that was asked for.
      render json: { accepted: true }, status: :accepted
    end
  end
end
