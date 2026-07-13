# One turn. Both members are named because the UI shows "Alice (covered by Bob)"; `responsible`
# resolves `covering_member || assigned_member` — the single question the reminder job, the calendar
# and this screen all ask — so the client never re-implements the precedence and gets it subtly
# wrong. `covered` is the one-glance flag for the same fact.
class ShiftSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      rota_id: record.rota_id,
      due_on: record.due_on,
      covered: record.covered?,
      assigned_member: member(record.assigned_member),
      covering_member: member(record.covering_member),
      responsible_member: member(record.responsible_member)
    }
  end

  private

  def member(member)
    return if member.nil?

    { id: member.id, name: member.name }
  end
end
