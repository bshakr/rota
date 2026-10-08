FactoryBot.define do
  factory :sms_message do
    shift
    member { shift.responsible_member }
    kind { "reminder" }
    days_before { 3 }
    # The rota's reminder at that timing, as the sweep would have claimed it.
    rota_reminder do
      shift.rota.reminders.find { |reminder| reminder.days_before == days_before } if shift && kind.to_s == "reminder"
    end
    status { "pending" }

    # A cover notice carries no offset: it is not one of the shift's scheduled reminders.
    trait :cover_notice do
      kind { "cover_notice" }
      days_before { nil }
    end

    trait :sent do
      status { "sent" }
      body { "Hi! It's your turn." }
      sequence(:twilio_sid) { |n| format("SM%032d", n) }
      sent_at { Time.current }
    end

    trait :failed do
      status { "failed" }
      error_code { "30006" }
    end
  end
end
