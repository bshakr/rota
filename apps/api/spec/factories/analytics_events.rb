FactoryBot.define do
  factory :analytics_event do
    # An anonymous event by default, because the four that carry no house are the ones a spec most
    # often needs to invent. Pass `group:` and a group name for the other six.
    name { AnalyticsEvent::LANDING_VIEW }
    occurred_at { Time.current }
    properties { {} }
  end
end
