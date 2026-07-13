require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
# require "active_storage/engine"
require "action_controller/railtie"
require "action_mailer/railtie"
# require "action_mailbox/engine"
# require "action_text/engine"
require "action_view/railtie"
# require "action_cable/engine"
# require "rails/test_unit/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

env_name = ENV["RAILS_ENV"] || ENV["RACK_ENV"] || "development"

# The monorepo keeps a single .env at its root, shared with apps/web, so there is one
# place to put a credential. Point dotenv at it instead of Rails.root (= apps/api).
# Must run before `class Application < Rails::Application`, which is what fires
# dotenv's before_configuration hook.
if defined?(Dotenv::Rails)
  monorepo_root = Pathname.new(File.expand_path("../../..", __dir__))

  Dotenv::Rails.files = [
    monorepo_root.join(".env.#{env_name}.local"),
    (monorepo_root.join(".env.local") unless env_name == "test"),
    monorepo_root.join(".env.#{env_name}"),
    monorepo_root.join(".env")
  ].compact
end

# DATABASE_URL and QUEUE_DATABASE_URL are a PRODUCTION-ONLY mechanism, and this is the
# line that enforces it.
#
# Rails applies DATABASE_URL to whichever environment is currently booting, and the
# monorepo's single .env is loaded in development AND test. So a DATABASE_URL naming the
# development database — which is exactly what a `cp .env.example .env` used to hand you —
# would silently repoint `rspec` at the development database, where `maintain_test_schema!`
# calls `db:test:prepare` and purges it. Only Rails' environment guard stood between that
# and a wiped dev database, and because the purge failure is swallowed the suite still
# reported green while connected to the wrong database.
#
# Development and test take their database NAMES from config/database.yml and nowhere
# else. Connection details (host, user, password) come from libpq's standard PGHOST /
# PGUSER / PGPASSWORD, which is how CI reaches its service container.
unless env_name == "production"
  ENV.delete("DATABASE_URL")
  ENV.delete("QUEUE_DATABASE_URL")
end

module HouserotaApi
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true

    # Groups carry their own timezone; the server always thinks in UTC.
    config.time_zone = "UTC"

    # Solid Queue's tables live in their own database in every environment, so that
    # db/schema.rb only ever describes the domain. See config/database.yml.
    config.solid_queue.connects_to = { database: { writing: :queue } }

    # Active Job logs its arguments at info. The reminder and cover-notice jobs will carry
    # member magic-link tokens and phone numbers as arguments, and a token is a permanent
    # bearer credential — it must never reach a log aggregator.
    config.active_job.log_arguments = false

    # Origins allowed to call this API from a browser. Defaults to the Next.js app; set
    # CORS_ORIGINS (comma-separated) when there is more than one, e.g. preview deploys.
    #
    # Blank counts as unset: ENV.fetch treats "" as present, and deploy platforms happily
    # inject empty strings for unset vars, so `CORS_ORIGINS=` would otherwise resolve to
    # an empty list and silently refuse the web app its own API.
    origins = (ENV["CORS_ORIGINS"].presence || ENV["APP_URL"].presence || "http://localhost:3001")
      .split(",").map(&:strip).reject(&:empty?)

    # "*" is refused outright rather than passed through. rack-cors treats it as
    # public_resources and hands the API to every site on the internet; nobody should be
    # able to do that by panic-setting an env var.
    if origins.include?("*")
      raise "CORS_ORIGINS must name explicit origins. \"*\" would expose this API to every site."
    end

    config.x.cors_origins = origins
  end
end
