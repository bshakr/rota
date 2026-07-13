# An admin, provisioned just-in-time from verified WorkOS JWT claims on each authenticated
# request. Rails holds no independent copy of WorkOS's membership state to drift out of sync —
# this table exists for foreign keys, display names and audit, not as a source of truth.
class User < ApplicationRecord
  has_many :group_admins, dependent: :destroy
  has_many :groups, through: :group_admins

  validates :workos_user_id, presence: true, uniqueness: true
  validates :email, presence: true
end
