# The shared secret the web app presents at /internal/analytics/events, resolved once, at boot.
#
# Deliberately unlike sms.rb and calendar_classifier.rb: a missing secret does NOT stop production
# booting. A silent SMS path is a broken product; missing analytics is a missing graph, and analytics
# must never be able to take the house's texts down with it.
#
# What a missing secret DOES do is close the endpoint. Internal::AnalyticsEventsController answers
# 404 when this is blank, so an unconfigured deploy has no open write path into the events table
# rather than an unauthenticated one. The events Rails writes in-process are unaffected.
Rails.application.configure do
  config.x.analytics.shared_secret = ENV["ANALYTICS_SHARED_SECRET"].presence
end
