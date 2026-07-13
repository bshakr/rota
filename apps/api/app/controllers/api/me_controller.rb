module Api
  # Proves the whole path in one request: bearer token -> verified claims -> just-in-time
  # provisioning -> Current. It is also what Next.js calls to find out who it is talking to.
  #
  # The domain endpoints are BLO-1047's.
  class MeController < BaseController
    def show
      render json: {
        user: {
          id: Current.user.id,
          workos_user_id: Current.user.workos_user_id,
          email: Current.user.email,
          name: Current.user.name
        },
        group: {
          id: Current.group.id,
          workos_organization_id: Current.group.workos_organization_id,
          name: Current.group.name,
          timezone: Current.group.timezone
        },
        role: Current.role
      }
    end
  end
end
