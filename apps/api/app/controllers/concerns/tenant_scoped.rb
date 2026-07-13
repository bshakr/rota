# Tenancy is enforced here, at the boundary, rather than by every controller remembering to.
#
# The group came from a signed claim (see Authenticatable). Reaching a tenant-owned record through
# `group_scope` means the query is *rooted* in that group, so there is no id a client can send that
# reaches out of it:
#
#   group_scope(:rotas).find(params[:id])     # another group's id => RecordNotFound => 404
#   group_scope(:members).create!(...)        # belongs to the token's group, and no other
#
# A controller that goes around this — `Rota.find(params[:id])` — is querying every house in the
# database, and no amount of care downstream can put that back. spec/controllers/tenant_scoped_spec
# is what holds the line.
module TenantScoped
  extend ActiveSupport::Concern

  # Raised when a controller mixes this in without Authenticatable, i.e. when there is no verified
  # group to scope to. A bug in our code, not a bad request, so it is a 500 and not a 404.
  class NoTenant < StandardError; end

  included do
    rescue_from ActiveRecord::RecordNotFound, with: :not_found
  end

  private

  # The group the token named. There is no setter, and no argument: it cannot be talked out of it.
  def current_group
    Current.group || raise(NoTenant, "#{self.class} is TenantScoped but the request was never authenticated")
  end

  def group_scope(association)
    current_group.public_send(association)
  end

  # 404, not 403. A 403 would confirm that the record exists, which is already more than another
  # house is entitled to know: to Alpha, Bravo's rota must look exactly like an id that never was.
  def not_found
    render json: { error: "not_found" }, status: :not_found
  end
end
