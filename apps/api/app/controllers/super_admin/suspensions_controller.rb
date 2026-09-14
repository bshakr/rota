module SuperAdmin
  # Pausing a house, and letting it go again.
  #
  # One piece of state with one way in and one way out: POST sets `groups.suspended_at`, DELETE
  # clears it. Both are idempotent, so a double-click, a retried request or a second operator
  # clicking the same button answers the same 200 with the same house, and a re-suspend never moves
  # "paused since" — which is the first thing anyone asks about a paused house.
  #
  # What suspension actually does is not here: it is five refusals spread across the app, each at
  # the point where the thing it stops would otherwise happen (Authenticatable, ReminderSweepJob,
  # TopUpShiftWindowsJob, Api::MemberBaseController, Public::HouseholdsController). This controller
  # only sets the flag they all read, which is why it is four lines long and they are not.
  #
  # Its own controller rather than two member actions on SuperAdmin::GroupsController, so that the
  # controller which reads every house in the database stays separate from the ones that write to
  # them.
  class SuspensionsController < BaseController
    def create
      change { |group| group.suspend! }
    end

    def destroy
      change { |group| group.resume! }
    end

    private

    # Unscoped on purpose — acting on any house by its id is the feature, and the allowlist, checked
    # by SuperAdminAuthenticatable before this action runs, is what stands in front of it. See
    # SuperAdmin::GroupsController#show for the longer version of why. An unknown id is a 404 from
    # SuperAdmin::BaseController.
    #
    # The audit is the log line Group#suspend!/#resume! writes, naming
    # `Current.super_admin_workos_user_id` — the verified WorkOS `sub` of whoever is asking.
    def change
      group = Group.find(params[:group_id])
      yield(group)

      render json: { group: GroupSerializer.solo(group) }
    end
  end
end
