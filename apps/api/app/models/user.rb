# An admin, provisioned just-in-time from verified WorkOS JWT claims on each authenticated
# request. Rails holds no independent copy of WorkOS's membership state to drift out of sync —
# this table exists for foreign keys, display names and audit, not as a source of truth.
class User < ApplicationRecord
  include JitProvisioning
  include LastSeen

  has_many :group_admins, dependent: :destroy
  has_many :groups, through: :group_admins
  has_many :sign_ins, dependent: :destroy

  validates :workos_user_id, presence: true, uniqueness: true
  validates :email, presence: true

  # The admin themselves, from claims that WorkOS signed and WorkosAccessToken verified — with no
  # house in sight.
  #
  # It lives here rather than inside GroupAdmin.provision! because there is now a second caller that
  # has no organization to provision beside the user: POST /api/sign_ins records a sign-in from a
  # token whose `org_id` may be missing, which is precisely the funnel step we most need (see
  # Api::SignInsController). Both callers must upsert the user the same way, so they do it through
  # the same method rather than through two that agree today.
  #
  # Idempotent and race-safe: the sign-in callback and the dashboard's first /api/me arrive within
  # milliseconds of each other on a brand new admin, both wanting to create this row.
  def self.provision!(claims)
    user = find_or_provision!({ workos_user_id: claims.workos_user_id }, defaults_from(claims))
    resync(user, claims)
    user
  end

  # An AuthKit access token carries no email and no name — they arrive only if the WorkOS JWT
  # template has been configured to add them. The column is NOT NULL, so a first sighting of an
  # admin without them gets a placeholder that is obviously a placeholder, and obviously not a
  # deliverable address. Nothing in this product emails an admin.
  def self.defaults_from(claims)
    {
      email: claims.email || "#{claims.workos_user_id}@users.workos.invalid",
      name: claims.name
    }
  end
  private_class_method :defaults_from

  # Only what WorkOS owns is written back on later requests, and only when it actually differs —
  # this runs on the authenticated read path, where the steady state must cost no writes at all.
  def self.resync(user, claims)
    user.update!(email: claims.email) if claims.email && claims.email != user.email
    user.update!(name: claims.name) if claims.name && claims.name != user.name
  end
  private_class_method :resync
end
