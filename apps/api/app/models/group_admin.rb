# An admin's access to a group. Deliberately not called a "membership": with participants called
# Members, that word would be ambiguous. A *member* only ever means "a person who takes turns".
class GroupAdmin < ApplicationRecord
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
  # group they all arrive here with nothing in the database yet.
  def self.provision!(claims)
    transaction do
      user = upsert(User, { workos_user_id: claims.workos_user_id }, user_defaults(claims))
      group = upsert(Group, { workos_organization_id: claims.workos_organization_id }, group_defaults(claims))
      group_admin = upsert(self, { user_id: user.id, group_id: group.id }, { role: claims.role })

      resync(user, group_admin, claims)
      group_admin
    end
  end

  # An AuthKit access token carries no email and no name — they arrive only if the WorkOS JWT
  # template has been configured to add them. The column is NOT NULL, so a first sighting of an
  # admin without them gets a placeholder that is obviously a placeholder, and obviously not a
  # deliverable address. Nothing in this product emails an admin.
  def self.user_defaults(claims)
    {
      email: claims.email || "#{claims.workos_user_id}@users.workos.invalid",
      name: claims.name
    }
  end
  private_class_method :user_defaults

  # Likewise the token names no group name and no timezone, and WorkOS could not know the timezone
  # anyway. The admin sets both in settings; these are what the group is called until they do.
  def self.group_defaults(claims)
    { name: "Group #{claims.workos_organization_id}", timezone: "UTC" }
  end
  private_class_method :group_defaults

  # Only what WorkOS owns is written back on later requests. The group's name and timezone are
  # ours, not WorkOS's, so re-applying the placeholders above would silently undo an admin's
  # settings on their very next request.
  def self.resync(user, group_admin, claims)
    user.update!(email: claims.email) if claims.email && claims.email != user.email
    user.update!(name: claims.name) if claims.name && claims.name != user.name
    group_admin.update!(role: claims.role) if claims.role != group_admin.role
  end
  private_class_method :resync

  # Find, or create, or — if a concurrent request created it between those two — find the row that
  # request created. The unique index is the referee. `requires_new` gives the failing INSERT its
  # own savepoint, without which it would take the surrounding transaction down with it.
  def self.upsert(model, identity, defaults)
    model.find_by(identity) || begin
      model.transaction(requires_new: true) { model.create!(identity.merge(defaults)) }
    rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => e
      model.find_by(identity) || raise(e)
    end
  end
  private_class_method :upsert
end
