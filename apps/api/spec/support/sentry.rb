# Sentry::TestHelper is not loaded by `require "sentry-ruby"`; the gem leaves it to the test suite to
# pull in. It gives a spec a DummyTransport (which opens no socket, so WebMock has nothing to block)
# and a dummy DSN, which is the only way to get the SDK to build a real event in an environment that
# deliberately has no DSN of its own. Specs include it themselves and call setup_sentry_test in a
# `before`, so only the specs that are about Sentry pay for it.
require "sentry/test_helper"

RSpec.configure do |config|
  # Two pieces of cleaning up, both about one spec not being able to change what the next one sees.
  # The suite runs in random order, so anything left behind is a failure that only happens on some
  # seeds, which is the worst kind to be handed.
  config.around do |example|
    unless Sentry.initialized?
      example.run
      next
    end

    hub = Sentry.get_main_hub
    booted_client = hub.current_client

    begin
      # Every real request gets its own Sentry scope, because Sentry::Rails::CaptureExceptions pushes
      # one around it: that is what keeps one admin's id off the next member's event. A controller
      # spec drives the controller directly and runs no middleware, so a `Sentry.set_user` in a
      # before_action would otherwise still be on the scope in whatever example ran next. Give every
      # example the isolation a request gets. The scope the boot-time `app: "api"` tag lives on is
      # this one's parent, so it survives.
      Sentry.with_scope { example.run }
    ensure
      # setup_sentry_test binds a client with a dummy DSN to the hub's base layer, and
      # teardown_sentry_test does not put the original back. Without this, every spec that ran after
      # a Sentry one would be looking at the test configuration rather than the one
      # config/initializers/sentry.rb built.
      hub.bind_client(booted_client) if booted_client
    end
  end
end
