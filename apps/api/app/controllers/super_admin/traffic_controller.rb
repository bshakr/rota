module SuperAdmin
  # Conversion and usage, for the traffic dashboard (BLO-1681).
  #
  # Thin on purpose: the whole argument — what a funnel step counts, where a week begins — lives in
  # SuperAdmin::Traffic, which is a query object so it can be tested without a request. All this
  # does is pick the window and decide what an unknown one means.
  class TrafficController < BaseController
    def show
      # `range` is optional, and deliberately so: a bare GET answers with the 30-day default. That
      # is what makes this route walkable by spec/requests/super_admin/authorization_spec.rb, which
      # discovers routes from the router and requests each one with no parameters.
      render json: Traffic.cached(range: params[:range])
    rescue Traffic::UnknownRange => e
      # 400, not a silent fall back to the default: a page asking for a window that does not exist
      # is a bug in the caller, and answering it with a different window's figures would hide that
      # behind numbers that look plausible.
      render_problem("invalid_range", :bad_request, message: e.message, allowed: Traffic::RANGES)
    end
  end
end
