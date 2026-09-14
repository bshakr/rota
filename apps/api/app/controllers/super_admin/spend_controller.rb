module SuperAdmin
  # What the houses cost, for the page that sets a price (BLO-1683).
  #
  # Thin on purpose: the whole argument lives in SuperAdmin::Spend, which is a query object so the
  # money arithmetic can be tested without a request. All this does is pick the window and decide
  # what an unknown one means.
  class SpendController < BaseController
    def show
      # `range` is optional, and deliberately so: a bare GET answers with the 30-day default. That
      # is what makes this route walkable by spec/requests/super_admin/authorization_spec.rb, which
      # discovers routes from the router and requests each one with no parameters.
      render json: Spend.cached(range: params[:range])
    rescue Spend::UnknownRange => e
      # 400, not a silent fall back to the default: a page asking for a window that does not exist
      # is a bug in the caller, and answering it with a different window's figures would hide that
      # behind numbers that look plausible.
      render_problem("invalid_range", :bad_request, message: e.message, allowed: Spend::RANGES)
    end
  end
end
