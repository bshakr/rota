# Lets specs call `create(:member)` instead of `FactoryBot.create(:member)`.
# Factories go in spec/factories/<plural_model_name>.rb.
RSpec.configure do |config|
  config.include FactoryBot::Syntax::Methods
end
