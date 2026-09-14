module Api
  # Every admin endpoint inherits from here, and inherits with it the two guarantees the API rests
  # on: the caller holds a WorkOS-signed token, and every record they can reach belongs to the
  # group that token named. Adding a controller that skips this is the one mistake nobody gets to
  # make quietly.
  class BaseController < ApplicationController
    # Never routed to directly; it exists to be inherited from.
    abstract!

    include Authenticatable
    include TenantScoped
    include ApiErrorRendering

    # After authenticate!, so a refused token never reaches it and Current is populated when it does.
    before_action :tag_sentry_scope

    private

    # What an event needs to be actionable: which house, and which admin. Both are ids and nothing
    # else. The WorkOS user id rather than our own row id, because the human reading the issue will
    # look the person up in WorkOS; the email and the name stay out on purpose (see
    # data_collection.user_info in config/initializers/sentry.rb). These are Sentry. calls, which
    # no-op when the SDK has no DSN, so development and test need nothing.
    def tag_sentry_scope
      Sentry.set_user(id: Current.user.workos_user_id)
      Sentry.set_tags(group_id: Current.group.id, surface: "admin")
    end
  end
end
