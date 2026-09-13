FactoryBot.define do
  factory :calendar_connection do
    group
    sequence(:ical_url) { |n| "https://calendar.google.com/calendar/ical/house#{n}%40gmail.com/private-#{SecureRandom.hex(16)}/basic.ics" }
    calendar_name { "Park Vista" }
  end
end
