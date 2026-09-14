namespace :sentry do
  # Proof from the real service that an event actually arrives, which is the one thing a green CI
  # run cannot tell you: the DSN, the network path out of Railway and the project the events land in
  # are all production-only facts. Run it once after the first deploy:
  #
  #   bin/rails sentry:smoke
  #
  # Expect two events in rota-api under this release, environment production, tagged app:api. Both
  # paths are exercised on purpose — capture_message is the SDK talking to Sentry directly, and the
  # Rails.error.report is the subscriber the jobs depend on, which is the half that silently does
  # nothing if register_error_subscriber is ever turned off.
  desc "Send one message and one exception to Sentry, tagged with this release"
  task smoke: :environment do
    # Read before the SDK is closed: Sentry.close unbinds the client, and Sentry.configuration is nil
    # from then on.
    release = Sentry.configuration.release

    Sentry.capture_message("sentry:smoke #{release}", level: :info)
    Rails.error.report(RuntimeError.new("sentry:smoke exception"), handled: true, source: "rotamonster.smoke")
    # The SDK sends on a background thread, and a rake task's process exits the moment the task
    # returns. Without this drain the events are built and then thrown away with the process.
    Sentry.close
    puts "sent; check rota-api for two events under release #{release.inspect}"
  end
end
