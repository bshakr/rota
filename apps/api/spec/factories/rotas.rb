FactoryBot.define do
  factory :rota do
    group
    sequence(:name) { |n| "Rota #{n}" }
    message_template { "Hi {{name}}! It's your turn for {{rota}} on {{date}} ({{days_until}})." }
    starts_on { Date.current }
    interval_count { 1 }
    interval_unit { "week" }
    send_hour { 9 }
    active { true }

    transient do
      # Timings for the reminders built with the rota, each carrying `message_template`. Pass
      # `reminders:` instead to build them yourself.
      reminder_days { [ 3, 0 ] }
    end

    after(:build) do |rota, evaluator|
      if rota.reminders.empty?
        evaluator.reminder_days.each do |days|
          rota.reminders.build(days_before: days, message_template: rota.message_template)
        end
      end
    end

    # A rota with no roster is in draft, so the plain factory builds a draft rota. Use this when
    # the rota needs to be able to generate shifts.
    trait :with_roster do
      transient do
        roster_size { 3 }
      end

      after(:create) do |rota, evaluator|
        evaluator.roster_size.times do |index|
          create(:rota_position,
            rota: rota,
            member: create(:member, group: rota.group),
            position: index)
        end

        rota.rota_positions.reload
      end
    end

    trait :inactive do
      active { false }
    end
  end
end
