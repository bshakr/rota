require "rails_helper"

# The wiring test for `config.rails.register_error_subscriber`, which is one line in
# config/initializers/sentry.rb and, without this spec, one line somebody could delete.
#
# Every `Rails.error.report` call in this codebase — the per-rota rescues in the two recurring jobs,
# the SMS failure paths, the WorkOS outage, and Solid Queue's own on_thread_error — depends on that
# subscriber existing. Until it did, those calls were genuine no-ops, which is exactly the state the
# job comments were written to warn about.
RSpec.describe "Rails.error reaches Sentry" do
  include Sentry::TestHelper

  before { setup_sentry_test }
  after { teardown_sentry_test }

  let(:boom) { RuntimeError.new("the sweep broke") }

  it "turns one report into exactly one event, with the source and context the job passed" do
    Rails.error.report(boom, context: { rota_id: 1 }, source: "rotamonster.reminder_sweep")

    expect(sentry_events.size).to eq(1)

    event = sentry_events.last
    expect(event.tags[:source]).to eq("rotamonster.reminder_sweep")
    expect(event.tags[:handled]).to be(true)
    expect(event.contexts["rails.error"][:rota_id]).to eq(1)
    expect(event.exception.values.last.value).to include("the sweep broke")
  end

  it "tags every event with the app it came from, so one organisation can hold both projects" do
    Rails.error.report(boom, source: "rotamonster.reminder_sweep")

    expect(sentry_events.last.tags[:app]).to eq("api")
  end

  it "runs the scrubber on the way out, wherever the event came from" do
    Rails.error.report(
      RuntimeError.new("The 'To' number +447700900123 is not a valid phone number"),
      context: { sms_message_id: 3 },
      source: "rotamonster.sms"
    )

    expect(JSON.generate(sentry_events.last.to_json_compatible)).not_to include("+447700900123")
  end

  it "reports an unhandled exception as unhandled, which is what wakes somebody" do
    Rails.error.report(boom, handled: false, source: "rotamonster.reminder_sweep")

    expect(sentry_events.last.tags[:handled]).to be(false)
  end
end
