require "rails_helper"
require "open3"

# Guards a bug that would otherwise hit every ticket built on this scaffold.
#
# `cp .env.example .env` used to hand you a DATABASE_URL naming the DEVELOPMENT database.
# Rails applies DATABASE_URL to whichever environment is booting, and dotenv loads the
# monorepo .env in test too — so `rspec` connected to the development database, and
# maintain_test_schema! then tried to purge it. Only Rails' environment guard stopped the
# wipe, and because the failure is swallowed the suite still reported green.
RSpec.describe "Test database isolation" do
  it "runs specs against the test database" do
    expect(ActiveRecord::Base.connection_db_config.database).to eq("houserota_api_test")
  end

  it "ignores a DATABASE_URL that points at the development database" do
    database = boot_test_env_with(
      "DATABASE_URL" => "postgres://localhost/houserota_api_development",
      "QUEUE_DATABASE_URL" => "postgres://localhost/houserota_api_development_queue"
    )

    expect(database).to eq("houserota_api_test")
  end

  # Boots a real child Rails process in the test environment with the given ENV, and
  # reports which database it resolved. An in-process test cannot cover this: the ENV is
  # read once, at boot, before any spec runs.
  def boot_test_env_with(env)
    script = "print ActiveRecord::Base.connection_db_config.database"
    stdout, stderr, status = Open3.capture3(
      env.merge("RAILS_ENV" => "test"),
      "bin/rails", "runner", script,
      chdir: Rails.root.to_s
    )

    raise "child Rails failed to boot: #{stderr}" unless status.success?

    stdout.strip
  end
end
