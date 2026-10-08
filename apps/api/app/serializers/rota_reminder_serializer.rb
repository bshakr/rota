class RotaReminderSerializer < ApplicationSerializer
  def as_json
    { id: record.id, days_before: record.days_before, message_template: record.message_template }
  end
end
