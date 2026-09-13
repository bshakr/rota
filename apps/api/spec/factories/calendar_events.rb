FactoryBot.define do
  factory :calendar_event do
    calendar_connection
    sequence(:uid) { |n| "uid-#{n}@google.com" }
    instance_key { "#{uid}#2026-09-20" }
    summary { "House dinner at home" }
    starts_on { Date.new(2026, 9, 20) }
    ends_on { Date.new(2026, 9, 20) }
    all_day { true }
    kind { "event" }
    # A factory-built event is one the model has already answered for. A spec that wants a pending
    # one says `classified_at: nil`.
    fingerprint { SecureRandom.hex(32) }
    classified_at { Time.current }
    synced_at { Time.current }
  end
end
