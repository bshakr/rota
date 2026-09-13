FactoryBot.define do
  factory :ai_call do
    group
    purpose { "calendar_classify" }
    # `add_attribute` because `model` is FactoryBot's own word for the class being built, and the
    # plain `model { ... }` form would redefine that instead of setting the column.
    add_attribute(:model) { "claude-haiku-4-5" }
    input_tokens { 1_200 }
    output_tokens { 300 }
    cache_creation_input_tokens { 0 }
    cache_read_input_tokens { 0 }
    items_count { 50 }
    succeeded { true }
    cost_usd { "0.002700".to_d }

    # What a 429 or a reply in the wrong shape leaves behind: the call is on the record, priced at
    # whatever the response admitted to, with the class that explains it.
    trait :failed do
      succeeded { false }
      error_class { "Anthropic::Errors::RateLimitError" }
      input_tokens { 0 }
      output_tokens { 0 }
      cost_usd { "0.0".to_d }
    end
  end
end
