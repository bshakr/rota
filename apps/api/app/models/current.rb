# Who is asking, and about which house. Set once per request by Authenticatable, from claims that
# have been cryptographically verified, and reset by Rails when the request ends.
#
# Only the group_admin is stored: it *is* the pairing of an admin with a group and a role, so the
# user and the group cannot be made to disagree with each other by anything setting one of them.
class Current < ActiveSupport::CurrentAttributes
  attribute :group_admin

  delegate :user, :group, :role, to: :group_admin, allow_nil: true
end
