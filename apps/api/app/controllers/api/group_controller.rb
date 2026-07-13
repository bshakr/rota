module Api
  # The group's own settings — name and, the one that matters, timezone. A group is JIT-provisioned
  # from a WorkOS token that carries no timezone, so it is born as UTC with `timezone_confirmed_at`
  # NULL: a guess nobody has confirmed. `groups.timezone` drives `send_hour` for every reminder, so
  # a London house left as UTC texts everyone an hour early once BST begins — silently, forever.
  # This is the one screen that lets a human fix that, and confirming the timezone is what stamps it.
  #
  # Singular resource: there is no id, ever. The group is the one the token named (Current.group),
  # so an admin can only read or write their own — the tenancy boundary needs no `find` here.
  class GroupController < BaseController
    def show
      render json: { group: GroupSerializer.one(current_group) }
    end

    def update
      group = current_group
      # A change in wall-clock, computed before the write, so the warning describes what setting this
      # timezone will do to reminders that are already scheduled.
      timezone_moved = group_params.key?(:timezone) && group_params[:timezone] != group.timezone

      group.assign_attributes(group_params)
      # The presence of a `timezone` in the request is the human confirming it — even if the value is
      # unchanged, "I checked, UTC is right" is exactly the confirmation the NULL was waiting for. So
      # the stamp keys off the param being sent, not off the value moving.
      group.timezone_confirmed_at = Time.current if group_params.key?(:timezone)
      group.save!

      render json: { group: GroupSerializer.one(group) }.merge(timezone_warning(timezone_moved))
    end

    private

    def group_params
      params.permit(:name, :timezone)
    end

    # Changing the timezone does not touch a single stored shift — the reminder sweep resolves the
    # zone at send time — so there is nothing to regenerate and nothing to confirm against. But it
    # does move the wall-clock moment of every future reminder, which the admin should be told, so
    # it rides back as a warning rather than a blocking prompt.
    def timezone_warning(moved)
      return {} unless moved

      { warning: { timezone_changed: true,
                   detail: "Every future reminder will now be sent at its send hour in the new timezone." } }
    end
  end
end
