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
  end
end
