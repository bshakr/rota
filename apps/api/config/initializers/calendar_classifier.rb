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

  # What a call costs, in dollars per million tokens, keyed by the model id sent on the wire and by
  # the same names as the ai_calls token columns, so a rate can never be applied to the wrong count.
  # Kept here, beside the model it prices, because changing one without the other is the mistake
  # worth making impossible.
  #
  # AiCall snapshots the cost onto every row, so editing a rate prices what comes next and leaves
  # what has already been reported alone. A model missing from this table is priced nil — not zero,
  # and not an exception: the tokens are still recorded and can be priced by hand.
  #
  # The cache rates are Anthropic's published multiples of the input rate: a read is a tenth of it,
  # a write to the five-minute cache a quarter again on top. Nothing caches today, because the
  # calendar spec (7.6) says the prompt is under Haiku's minimum cacheable prefix, but the counts are
  # recorded either way, and a column recorded without a rate is a cost that quietly reads as zero.
  haiku_input = "1.0".to_d
  config.x.calendar_classifier.rates = {
    "claude-haiku-4-5" => {
      input_tokens: haiku_input,
      output_tokens: "5.0".to_d,
      cache_read_input_tokens: haiku_input * "0.1".to_d,
      cache_creation_input_tokens: haiku_input * "1.25".to_d
    }.freeze
  }.freeze
end
