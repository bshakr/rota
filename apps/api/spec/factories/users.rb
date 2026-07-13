FactoryBot.define do
  factory :user do
    sequence(:workos_user_id) { |n| "user_#{n}" }
    sequence(:email) { |n| "admin#{n}@example.com" }
    name { "Ada Admin" }
  end
end
