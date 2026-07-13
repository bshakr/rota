# `travel_to` and friends. The whole rota engine is date arithmetic, so almost every spec below
# services/ and jobs/ needs to say what "now" is rather than hope the clock cooperates.
RSpec.configure do |config|
  config.include ActiveSupport::Testing::TimeHelpers
end
