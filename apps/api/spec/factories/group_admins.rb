FactoryBot.define do
  factory :group_admin do
    user
    group
    role { "admin" }
  end
end
