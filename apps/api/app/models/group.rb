# A tenant. Maps 1:1 onto a WorkOS Organization, which is the source of truth for admin identity.
# Members and rotas are never stored in WorkOS.
class Group < ApplicationRecord
  # Rotas are destroyed before members on purpose: shifts point at members with a NOT NULL foreign
  # key, and Member refuses to be destroyed while any shift still names it. Clearing the rotas
  # clears their shifts, which is what frees the members to go.
  has_many :rotas, dependent: :destroy
  has_many :members, dependent: :destroy
  has_many :group_admins, dependent: :destroy
  has_many :admins, through: :group_admins, source: :user

  validates :workos_organization_id, presence: true, uniqueness: true
  validates :name, presence: true
  validates :timezone, presence: true
  validate :timezone_must_be_recognised

  # The group's wall clock. The reminder sweep computes each shift's send moment as `send_hour` in
  # *this* zone, which is what makes a 9am reminder still arrive at 9am after the clocks change.
  def time_zone
    ActiveSupport::TimeZone[timezone]
  end

  private

  def timezone_must_be_recognised
    return if timezone.blank?
    return if ActiveSupport::TimeZone[timezone]

    errors.add(:timezone, "is not a recognised time zone")
  end
end
