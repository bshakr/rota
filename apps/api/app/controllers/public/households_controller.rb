module Public
  # Intentionally does not inherit the WorkOS/admin controller. Responses contain
  # household identification only, never member identities or personal-link tokens.
  class HouseholdsController < ApplicationController
    def show
      response.headers["Cache-Control"] = "no-store"
      group = Group.find_by(slug: params[:slug])
      return render json: { error: "not_found" }, status: :not_found unless group

      render json: { household: { name: group.name, slug: group.slug } }
    end

    def request_link
      HouseholdEntry.request_link(slug: params[:slug], phone: params[:phone])
      response.headers["Cache-Control"] = "no-store"
      # Same status and payload for unknown houses/numbers, opt-outs and rate limits.
      render json: { accepted: true }, status: :accepted
    end
  end
end
