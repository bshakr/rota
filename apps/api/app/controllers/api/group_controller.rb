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

      # A NULL `timezone_confirmed_at` is what "nobody has set this house up yet" looks like, so this
      # request being the one that stamps it IS the house being named. Read it before the write.
      naming = !group.timezone_confirmed? && group_params.key?(:timezone)

      group.assign_attributes(group_params.except(:first_touch))
      # First touch is first: a house records where it came from once, and a later request can never
      # overwrite it. `/setup` sends it exactly once and clears its cookie, but the API is what
      # guarantees the value, because a replayed PATCH must not relabel a house's origin.
      group.first_touch = FirstTouch.sanitise(group_params[:first_touch]) if group.first_touch.blank?
      # The presence of a `timezone` in the request is the human confirming it — even if the value is
      # unchanged, "I checked, UTC is right" is exactly the confirmation the NULL was waiting for. So
      # the stamp keys off the param being sent, not off the value moving.
      group.timezone_confirmed_at = Time.current if group_params.key?(:timezone)
      group.save!

      # The top of the funnel's first server-side step, and the only event that carries the campaign
      # that brought the house here — which is what makes every later event attributable.
      AnalyticsEvent.record(AnalyticsEvent::HOUSE_NAMED, group: group, **(group.first_touch || {})) if naming

      render json: { group: GroupSerializer.one(group) }.merge(timezone_warning(timezone_moved))
    end

    private

    # `first_touch` is permitted as five named scalars and nothing else, so a client cannot post an
    # arbitrary document into a jsonb column. FirstTouch then trims, caps and drops blanks.
    def group_params
      params.permit(:name, :timezone, first_touch: FirstTouch::KEYS)
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
