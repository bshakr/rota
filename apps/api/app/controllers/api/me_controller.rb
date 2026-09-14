module Api
  # Proves the whole path in one request: bearer token -> verified claims -> just-in-time
  # provisioning -> Current. It is also what Next.js calls to find out who it is talking to.
  #
  # The domain endpoints are BLO-1047's.
  class MeController < BaseController
    # The one endpoint a paused house may still read (BLO-1675). Everything else under /api answers
    # 403 `group_suspended`, and the web app turns that into the paused screen — a screen which has
    # to be able to say WHICH house is paused, and this is where it gets the name from. Exempting it
    # is what makes the paused screen possible at all; a 403 here would leave the web with a house
    # it could not name.
    #
    # Deliberately no `suspended` field in the payload. The web never has to ask: the 403 on the
    # route it actually wanted is what puts it on the paused screen, and a second, weaker signal
    # here would be one more thing that could disagree with the enforcement.
    skip_before_action :refuse_suspended_group

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
