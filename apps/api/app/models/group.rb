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

  # The group's own calendar date — what "today" means in this house.
  #
  # `Date.current` is UTC here (config.time_zone), and every question of the form "is this shift in
  # the future?" gets a wrong answer from it in both directions. At 23:00 UTC it is already
  # tomorrow in Auckland, so UTC would call today's shift a future one and let a config change
  # delete and reassign a turn the members were texted about this morning. At 02:00 UTC it is
  # still yesterday in Honolulu, so UTC would call tomorrow's shift a past one and refuse to
  # regenerate a turn that is genuinely still a day away, and whose day-of reminder has not gone
  # out. Neither is a rounding error: both rewrite or freeze a real person's chore.
  #
  # So the boundary is the group's midnight, not the server's, and this is the one place that says
  # so.
  def today
    Time.current.in_time_zone(time_zone).to_date
  end

  private

  def timezone_must_be_recognised
    return if timezone.blank?
    return if ActiveSupport::TimeZone[timezone]

    errors.add(:timezone, "is not a recognised time zone")
  end
end
