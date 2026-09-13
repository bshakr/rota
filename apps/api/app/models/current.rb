# Who is asking, and about which house. Set once per request by Authenticatable, from claims that
# have been cryptographically verified, and reset by Rails when the request ends.
#
# Only the group_admin is stored: it *is* the pairing of an admin with a group and a role, so the
# user and the group cannot be made to disagree with each other by anything setting one of them.
class Current < ActiveSupport::CurrentAttributes
  attribute :group_admin

  # The operator, when the request came in through the super admin front door (BLO-1669). It is the
  # verified WorkOS `sub` and nothing more: there is no row for a super admin — the allowlist is an
  # environment variable — and there is deliberately no group beside it, because an operator acts
  # across houses rather than inside one. Set by SuperAdminAuthenticatable, and what the audit lines
  # of the later super admin tickets name.
  attribute :super_admin_workos_user_id

  delegate :user, :group, :role, to: :group_admin, allow_nil: true
end
