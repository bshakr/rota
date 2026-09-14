# Where every unexpected exception in this app goes.
#
# The rules live in the SentryBoot module below rather than inline in the Sentry.init block, for the
# same reason SmsBoot exists in config/initializers/sms.rb: they are safety-critical and they must be
# testable without booting a production environment. The module is a top-level constant rather than
# app code under a namespace because an initializer runs before the autoloader will resolve
# reloadable constants, and this must run at boot.
module SentryBoot
  module_function

  # Production without a DSN is refused at boot. An app that runs unreported is one whose first
  # symptom of a broken sweep is a house that stopped being texted. Everywhere else a missing DSN
  # simply disables the SDK: development never sends, test never sends.
  def dsn_for(env:, value:)
    return value if value.present?
    return nil unless env.production?

    raise "SENTRY_DSN must be set in production. An unreported exception is a silent one."
  end
end

Sentry.init do |config|
  config.dsn = SentryBoot.dsn_for(env: Rails.env, value: ENV["SENTRY_DSN"])
  config.environment = ENV["SENTRY_ENVIRONMENT"].presence || Rails.env
  config.release = ENV["SENTRY_RELEASE"].presence || ENV["RAILWAY_GIT_COMMIT_SHA"].presence

  # Only these environments ever send. Development stays silent even with a DSN pasted into .env;
  # set SENTRY_ENVIRONMENT=preview locally to exercise the wire on purpose.
  config.enabled_environments = %w[ production preview ]

  # The point of the whole exercise: Rails.error.report gets a subscriber. Every existing call in the
  # jobs, and Solid Queue's on_thread_error, starts producing events.
  config.rails.register_error_subscriber = true

  # Transient Twilio failures retry with backoff on purpose (SendSmsJob). Reporting each attempt
  # would page five times for one wobble; exhaustion is reported by hand instead.
  config.rails.active_job_report_on_retry_error = false

  # Errors only, in phase 1. Tracing is a later decision, and it costs quota.
  config.traces_sample_rate = ENV.fetch("SENTRY_TRACES_SAMPLE_RATE", "0").to_f

  # What may be collected. Everything a member's token or number could ride in is off. This replaces
  # send_default_pii, which sentry-ruby 7 deprecates, and it is deliberately stricter than the
  # send_default_pii = false defaults: bodies, query strings and SQL are refused outright rather than
  # filtered, because a filter only redacts the keys somebody remembered to name.
  dc = config.data_collection
  dc.user_info = false                      # we set the user by hand, id only, in Api::BaseController
  dc.cookies.mode = :off
  dc.http_headers.request.mode = :deny_list
  dc.http_headers.request.terms = %w[ authorization cookie x-twilio-signature ]
  dc.http_bodies = []                       # no request or response bodies, ever
  dc.url_query_params.mode = :off
  dc.database_query_data = false
  dc.stack_frame_variables = false          # SendSmsJob holds the rendered magic link in a local
  dc.frame_context_lines = 3

  # Breadcrumbs from Rails' own instrumentation, not from outgoing HTTP: the Twilio client URLs carry
  # the account SID, and there is nothing in them the SMS log does not already say.
  config.breadcrumbs_logger = [ :active_support_logger ]
  config.max_breadcrumbs = 30

  # Last line of defence, and the one that assumes every control above has been got wrong. The
  # scrubber is a plain object under app/lib so it has a spec of its own.
  config.before_send = ->(event, _hint) { SentryScrubber.call(event) }
end

# Every event from this process says which app it came from, so one organisation can hold both the
# Rails and the Next.js projects and a search can still tell them apart. Child scopes inherit it.
Sentry.configure_scope { |scope| scope.set_tags(app: "api") }
