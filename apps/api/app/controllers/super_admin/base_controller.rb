module SuperAdmin
  # Every operator endpoint inherits from here. It is the twin of Api::BaseController, and the
  # difference between them is the whole design: that one guarantees a caller can only ever reach
  # its own group's records, and this one exists precisely to read across all of them.
  #
  # So it deliberately does NOT include TenantScoped. Reusing the house side's `group_scope` with
  # some escape hatch would put a way out of the tenant boundary inside the tenant boundary, which
  # is the one bug nobody gets to make quietly. Two base controllers, two invariants, each with its
  # own spec: spec/controllers/tenant_scoped_spec.rb holds that line, and
  # spec/requests/super_admin/authorization_spec.rb holds this one.
  class BaseController < ApplicationController
    # Never routed to directly; it exists to be inherited from.
    abstract!

    include SuperAdminAuthenticatable
    include ApiErrorRendering

    # After authenticate_super_admin!, so a refused caller never reaches it and Current names the
    # operator when it does.
    before_action :tag_sentry_scope

    # An id that names no house. 404, the same status the house side answers for an id it cannot
    # reach (TenantScoped#not_found), but for the opposite reason: there it hides whether a record
    # exists from somebody not entitled to know. Here the caller has already passed the allowlist,
    # so this really does mean "no such house" — a stale bookmark, or a group deleted since. The
    # refusal that hides this whole area from a caller who is NOT on the allowlist is a different
    # 404 entirely, rendered by SuperAdminAuthenticatable before any action runs, and deliberately
    # byte-identical to the one an unrouted path gets.
    rescue_from ActiveRecord::RecordNotFound, with: :not_found

    private

    # Which operator, and nothing else. The WorkOS user id is the only name we have for them —
    # there is no row for a super admin — and it is the name the human reading the issue will look
    # up in WorkOS; the email stays out on purpose, here as on the house side (see
    # data_collection.user_info in config/initializers/sentry.rb). No group tag either: an operator
    # acts across every house, which is what `surface` says instead. These are Sentry. calls, which
    # no-op when the SDK has no DSN, so development and test need nothing.
    def tag_sentry_scope
      Sentry.set_user(id: Current.super_admin_workos_user_id)
      Sentry.set_tags(surface: "super-admin")
    end

    def not_found
      render json: { error: "not_found" }, status: :not_found
    end
  end
end
