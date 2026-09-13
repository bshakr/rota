require "rails_helper"
require "rake"

# The one-off that recovers the spend history Twilio still remembers (plan, Rollout step 4).
#
# The thing this spec is really guarding is the last example: the task is meant to be run by hand,
# once, against production, and the only reason that is a safe thing to ask of anybody is that it
# cannot send a text. WebMock would raise on an unstubbed request, so a POST to Twilio would fail
# the run — but a POST that someone had stubbed would not, which is why it is asserted outright.
RSpec.describe "twilio:backfill_prices" do
  before(:all) do
    Rake.application = Rake::Application.new
    Rails.application.load_tasks
  end

  after(:all) { Rake.application = nil }

  let(:task) { Rake::Task["twilio:backfill_prices"] }

  # The task prints as it goes, which is the point of it when it is walking thousands of rows by
  # hand — but not something the suite needs to read.
  def run_task(*args)
    original = $stdout
    $stdout = StringIO.new
    task.reenable
    task.invoke(*args)
    $stdout.string
  ensure
    $stdout = original
  end

  def sent_message(sid:, created_at: 1.day.ago, **attributes)
    create(:sms_message, :sent, twilio_sid: sid, created_at: created_at, **attributes)
  end

  it "records what Twilio charged, as a positive amount" do
    message = sent_message(sid: "SM00000000000000000000000000000001")
    stub_twilio_fetch(sid: message.twilio_sid, price: "-0.00790", price_unit: "USD")

    run_task("0")

    expect(message.reload.price).to eq(BigDecimal("0.0079"))
    expect(message.price_unit).to eq("USD")
    expect(message.price_fetched_at).to be_present
  end

  # The whole history, not the nightly job's seven-day window: Twilio keeps message records for
  # about thirteen months, so everything sent before Phase 0 is still recoverable.
  it "reaches rows far older than the nightly job's window" do
    ancient = sent_message(sid: "SM00000000000000000000000000000002", created_at: 200.days.ago)
    stub_twilio_fetch(sid: ancient.twilio_sid)

    run_task("0")

    expect(ancient.reload.price_fetched_at).to be_present
  end

  it "prints its progress, so a long run can be watched" do
    message = sent_message(sid: "SM00000000000000000000000000000003")
    stub_twilio_fetch(sid: message.twilio_sid)

    output = run_task("0")

    expect(output).to include(message.twilio_sid, "priced")
  end

  it "never sends a text" do
    message = sent_message(sid: "SM00000000000000000000000000000004")
    stub_twilio_fetch(sid: message.twilio_sid)
    sends = stub_twilio_send

    run_task("0")

    expect(sends).not_to have_been_requested
    expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
  end
end
