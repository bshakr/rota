# Everything the away classifier needs, resolved once, at boot, for the same reason the SMS rules
# are resolved at boot: production refuses to boot misconfigured rather than discover it from a
# house whose calendar never sorted itself.
#
# The key check is inlined rather than borrowed from SmsBoot. Rails loads initializers in
# alphabetical order, so sms.rb has not run yet, and one initializer requiring another is a load
# order dependency that breaks the first time either file is renamed.
Rails.application.configure do
  # No development fallback on purpose. Spec section 7.4 says a missing key outside production must
  # behave exactly like a failed call, so CalendarClassifier raises Failed, CalendarSync catches it,
  # and the events sit pending until somebody sets the key.
  api_key = ENV["ANTHROPIC_API_KEY"].presence

  if api_key.nil? && Rails.env.production?
    raise "ANTHROPIC_API_KEY must be set in production. The calendar classifier cannot run without it."
  end

  config.x.calendar_classifier.api_key = api_key

  # Haiku 4.5 is a fraction of Sonnet's price and plenty for one-line titles. Switching is this one
  # string plus a rerun of bin/classifier-eval (spec open question 2).
  config.x.calendar_classifier.model = "claude-haiku-4-5"
end
