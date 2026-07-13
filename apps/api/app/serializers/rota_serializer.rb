# A rota, with its ordered roster inline. `draft` is derived from the roster (Rota#draft?), never
# stored, so the flag and the roster can never disagree — the UI shows the "add someone to start"
# state straight off it. `positions` is ordered because the association is (`-> { order(:position) }`),
# and that order IS the rotation.
class RotaSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      name: record.name,
      message_template: record.message_template,
      starts_on: record.starts_on,
      interval_count: record.interval_count,
      interval_unit: record.interval_unit,
      send_hour: record.send_hour,
      reminder_offsets: record.reminder_offsets,
      active: record.active,
      draft: record.draft?,
      positions: positions
    }
  end

  private

  def positions
    record.rota_positions.map do |position|
      {
        member_id: position.member_id,
        name: position.member.name,
        position: position.position
      }
    end
  end
end
