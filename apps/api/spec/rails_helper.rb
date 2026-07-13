# Loaded by every spec: `require "rails_helper"` at the top of the file.
require "spec_helper"
ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
abort("The Rails environment is running in production mode!") if Rails.env.production?
require "rspec/rails"

# Custom matchers, shared examples and third-party setup live in spec/support.
Rails.root.glob("spec/support/**/*.rb").sort_by(&:to_s).each { |f| require f }

# Last line of defence before maintain_test_schema! purges whatever it is connected to.
# config/application.rb already deletes DATABASE_URL outside production so this cannot
# normally trigger, but the cost of being wrong here is a wiped development database.
connected_to = ActiveRecord::Base.connection_db_config.database
unless connected_to.to_s.end_with?("_test")
  abort <<~MESSAGE
    Refusing to run specs against #{connected_to.inspect}.

    The test environment must use the test database — the next thing to run is
    maintain_test_schema!, which purges it. Check DATABASE_URL and config/database.yml.
  MESSAGE
end

# Recreates the test database from db/schema.rb if migrations are pending.
begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end

RSpec.configure do |config|
  config.fixture_paths = [ Rails.root.join("spec/fixtures") ]
  config.use_transactional_fixtures = true

  # spec/models/*_spec.rb gets `type: :model`, spec/requests/*_spec.rb gets `type: :request`,
  # and so on — no need to tag each spec by hand.
  config.infer_spec_type_from_file_location!

  config.filter_rails_from_backtrace!
end
