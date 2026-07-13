# One member's slot in one rota's running order. The rotation is `positions[i % positions.count]`,
# so this table *is* the turn order.
class RotaPosition < ApplicationRecord
  belongs_to :rota
  belongs_to :member

  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :position, uniqueness: { scope: :rota_id }
  validates :member_id, uniqueness: { scope: :rota_id, message: "is already on this rota" }
  validate :member_must_belong_to_the_rotas_group

  private

  # Tenancy, enforced one level below the request. A rota may only be worked by members of its own
  # group — otherwise a stray member_id would put a stranger on the roster and, in time, text them.
  def member_must_belong_to_the_rotas_group
    return if member.nil? || rota.nil?
    return if member.group_id == rota.group_id

    errors.add(:member, "must belong to the same group as the rota")
  end
end
