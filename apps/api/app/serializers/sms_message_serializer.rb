# One line of the delivery log — the screen that answers "why didn't Alice get her text". It carries
# the carrier `status` and `error_code` side by side so that question has one row to read, the `body`
# that was actually sent, and enough of the shift and rota to say which reminder this was without a
# second lookup.
class SmsMessageSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      kind: record.kind,
      status: record.status,
      error_code: record.error_code,
      days_before: record.days_before,
      body: record.body,
      twilio_sid: record.twilio_sid,
      sent_at: record.sent_at,
      created_at: record.created_at,
      member: member,
      shift: shift
    }
  end

  private

  def member
    { id: record.member_id, name: record.member.name }
  end

  def shift
    {
      id: record.shift_id,
      rota_id: record.shift.rota_id,
      rota_name: record.shift.rota.name,
      due_on: record.shift.due_on
    }
  end
end
