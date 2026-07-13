FactoryBot.define do
  factory :group do
    sequence(:workos_organization_id) { |n| "org_#{n}" }
    sequence(:name) { |n| "Flat #{n}, Alma Road" }
    timezone { "Europe/London" }
  end
end
