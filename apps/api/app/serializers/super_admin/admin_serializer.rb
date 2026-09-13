module SuperAdmin
  # A house admin, from the join row rather than the user, because the role belongs to the
  # membership and not to the person — the same human can be an admin of one house and an owner of
  # another.
  class AdminSerializer < ApplicationSerializer
    def as_json
      {
        # The membership's own id, not the person's: this row IS the GroupAdmin, and the same human
        # appears again under a different id on another house's page. `user_id` is beside it for
        # the cases that are about the person rather than the membership.
        id: record.id,
        user_id: user.id,
        name: user.name,
        # An AuthKit access token carries no email unless the WorkOS JWT template has been
        # configured to add one, so a first sighting is provisioned with a placeholder at an
        # .invalid domain (see GroupAdmin.user_defaults). Serving that placeholder would put an
        # address on screen that looks deliverable and is not; `null` is what the console renders
        # as "not provided".
        email: user.email_placeholder? ? nil : user.email,
        # The id to paste into the WorkOS dashboard — impersonation and password resets live there,
        # with an audit trail, and are deliberately not built here.
        workos_user_id: user.workos_user_id,
        role: record.role
      }
    end

    private

    def user = record.user
  end
end
