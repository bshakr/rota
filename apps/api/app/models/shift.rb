# One turn: a rota, a date, and whoever is on the hook for it.
#
# Shifts are materialised as real rows, but only for a bounded window — all past shifts plus
# roughly the next 90 days. Past shifts are immutable history: once a date passes, the row records
# who was actually responsible, cover included, and nothing ever rewrites it. Future shifts are
# derived and disposable; config changes delete and regenerate them.
class Shift < ApplicationRecord
  belongs_to :rota
  # What the rota says.
  belongs_to :assigned_member, class_name: "Member", inverse_of: :assigned_shifts
  # The override. This one nullable association is the entire swap feature.
  belongs_to :covering_member, class_name: "Member", optional: true, inverse_of: :covering_shifts

  has_many :sms_messages, dependent: :destroy

  scope :upcoming, -> { where(due_on: Date.current..) }

  validates :due_on, presence: true, uniqueness: { scope: :rota_id }
  validate :cover_must_differ_from_the_assignee
  validate :members_must_belong_to_the_rotas_group

  # The one method. The reminder job, the calendar and the member page all call it.
  #
  # Reminders resolve this at *send* time rather than at schedule time, which is why a handover
  # needs no special reminder logic: hand Alice's shift to Bob and every remaining reminder goes
  # to him automatically. Nothing to reschedule, nothing to cancel.
  def responsible_member
    covering_member || assigned_member
  end

  def covered?
    covering_member_id.present?
  end

  private

  def cover_must_differ_from_the_assignee
    return if covering_member_id.nil?
    return if covering_member_id != assigned_member_id

    errors.add(:covering_member, "is already responsible for this shift")
  end

  # Tenancy, enforced one level below the request: a shift may only ever name members of its own
  # rota's group, so no cover can hand a turn to a stranger in another house.
  def members_must_belong_to_the_rotas_group
    return if rota.nil?

    { assigned_member: assigned_member, covering_member: covering_member }.each do |name, member|
      next if member.nil?
      next if member.group_id == rota.group_id

      errors.add(name, "must belong to the same group as the rota")
    end
  end
end
