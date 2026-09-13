# An admin's access to a group. Deliberately not called a "membership": with participants called
# Members, that word would be ambiguous. A *member* only ever means "a person who takes turns".
class GroupAdmin < ApplicationRecord
  include JitProvisioning

  belongs_to :user
  belongs_to :group

  # WorkOS owns the role vocabulary (its organization role slug), so it is stored, not policed.
  validates :role, presence: true
  validates :user_id, uniqueness: { scope: :group_id }

  # Just-in-time provisioning, from claims that WorkOS signed and WorkosAccessToken verified.
  #
  # WorkOS is the source of truth for admin identity, so Rails keeps no independent copy of its
  # membership state to drift out of sync: these rows are rebuilt from the token on every request
  # and exist for foreign keys, display and audit. Which means this must be idempotent, and it must
  # survive losing a race — the first page load fires several API calls at once, and on a brand new
  # group they all arrive here with nothing in the database yet. JitProvisioning is where that is
  # handled, once, for every row rebuilt this way.
  #
  # This runs on EVERY authenticated request, which is almost always a steady-state read by an admin
  # who already exists and whose role has not changed. That common case must not pay for the rare
  # one: `settled` returns the existing membership with zero writes and no transaction when nothing
  # in the token would change a row. Only a first sighting, a role change, or a new email/name in the
  # claim falls through to the write path below — which stays idempotent and race-safe.
  def self.provision!(claims)
    settled(claims) || transaction do
      # The user half is User.provision!'s, because POST /api/sign_ins provisions a user from a
      # token that names no organization and must do it the same way this does.
      user = User.provision!(claims)
      group = Group.find_or_provision!({ workos_organization_id: claims.workos_organization_id }, group_defaults(claims))
      group_admin = find_or_provision!({ user_id: user.id, group_id: group.id }, { role: claims.role })

      resync(group_admin, claims)
      group_admin
    end
  end

  # The read-only hot path. Returns the existing membership only when the token would write nothing:
  # the user and group already exist, the role matches, and the claim carries no email/name that
  # differs from what is stored. Any miss returns nil, and provision! takes the write path. The
  # already-loaded user and group are attached so the caller (Current, then /api/me) does not
  # re-query them.
  def self.settled(claims)
    user = User.find_by(workos_user_id: claims.workos_user_id)
    return unless user
    return if claims.email && claims.email != user.email
    return if claims.name && claims.name != user.name

    group = Group.find_by(workos_organization_id: claims.workos_organization_id)
    return unless group

    group_admin = find_by(user_id: user.id, group_id: group.id)
    return unless group_admin
    return if group_admin.role != claims.role

    group_admin.association(:user).target = user
    group_admin.association(:group).target = group
    group_admin
  end
  private_class_method :settled

  # The token names no group name and no timezone, and WorkOS could not know the timezone anyway.
  # The admin sets both in settings; these are what the group is called until they do.
  def self.group_defaults(claims)
    { name: "Group #{claims.workos_organization_id}", timezone: "UTC" }
  end
  private_class_method :group_defaults

  # Only what WorkOS owns is written back on later requests. The group's name and timezone are
  # ours, not WorkOS's, so re-applying the placeholders above would silently undo an admin's
  # settings on their very next request. The user's own email and name are re-synced by
  # User.provision!, for the same reason and under the same rule.
  def self.resync(group_admin, claims)
    group_admin.update!(role: claims.role) if claims.role != group_admin.role
  end
  private_class_method :resync
end
