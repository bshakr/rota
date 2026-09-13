# Rows that are rebuilt from verified WorkOS claims rather than owned by us.
#
# WorkOS is the source of truth for admin identity, so `users`, `groups` and `group_admins` are
# provisioned just-in-time from the token on every authenticated request, and exist here for foreign
# keys, display and audit. Which means creating one must be idempotent, and it must survive losing a
# race — the first page load of a brand new house fires several API calls at once, and the sign-in
# callback (Api::SignInsController) arrives alongside them, all with nothing in the database yet.
module JitProvisioning
  extend ActiveSupport::Concern

  class_methods do
    # Find, or create, or — if a concurrent request created it between those two — find the row that
    # request created. The unique index is the referee. `requires_new` gives the failing INSERT its
    # own savepoint, without which it would take the surrounding transaction down with it.
    def find_or_provision!(identity, defaults)
      find_by(identity) || begin
        transaction(requires_new: true) { create!(identity.merge(defaults)) }
      rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => e
        find_by(identity) || raise(e)
      end
    end
  end
end
