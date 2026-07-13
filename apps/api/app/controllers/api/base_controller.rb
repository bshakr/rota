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
  end
end
