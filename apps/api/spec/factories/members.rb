FactoryBot.define do
  factory :member do
    group
    sequence(:name) { |n| "Member #{n}" }
    # A real, valid GB mobile shape — Member rejects anything libphonenumber will not dial, so a
    # placeholder like "+15555555555" would fail the factory's own model.
    sequence(:phone_e164) { |n| format("+44740%07d", n) }
    active { true }

    trait :inactive do
      active { false }
    end

    trait :opted_out do
      sms_opted_out_at { 1.day.ago }
    end
  end
end
