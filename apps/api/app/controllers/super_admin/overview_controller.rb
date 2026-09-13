module SuperAdmin
  # The operator's landing page: KPI tiles, the attention list, the last ten houses with how far
  # each of them got, and the health of the recurring jobs.
  #
  # Everything it serves comes from SuperAdmin::Overview, which is deliberately parameterless — this
  # action reads nothing from the request. There is no id, no filter and no range to smuggle a
  # cross-tenant lookup through, and the payload is identical for every allowlisted operator, which
  # is what lets one cached copy serve all of them.
  class OverviewController < BaseController
    def show
      render json: SuperAdmin::Overview.call
    end
  end
end
