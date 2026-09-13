FactoryBot.define do
  factory :sign_in do
    user
    workos_organization_id { "org_01FLAT" }
    # Unique per row, because the unique index on it is what makes recording a sign-in idempotent.
    sequence(:jti) { |n| "jti_#{n}" }

    # The funnel step the whole table exists for: somebody signed in and has no house yet.
    trait :without_organization do
      workos_organization_id { nil }
    end
  end
end
