FactoryBot.define do
  factory :shift do
    rota
    due_on { 7.days.from_now.to_date }
    # Members of the rota's own group; Shift rejects anything else.
    assigned_member { association :member, group: rota.group }

    trait :covered do
      covering_member { association :member, group: rota.group }
    end

    trait :past do
      due_on { 7.days.ago.to_date }
    end
  end
end
