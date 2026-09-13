module SuperAdmin
  # The operator's landing page. Empty on purpose in this ticket: it gives the namespace a route to
  # exist at, so the allowlist boundary has something to be tested against before there is anything
  # worth reading. The KPI tiles, attention list and recent houses it will carry are BLO-1677
  # (https://linear.app/bloombase/issue/BLO-1677).
  class OverviewController < BaseController
    def show
      render json: {}
    end
  end
end
