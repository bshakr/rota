require "rails_helper"

RSpec.describe SyncHouseCalendarsJob do
  # Pinned so the fixture's September dates sit inside the sync window whenever this spec is run,
  # rather than only until the real clock walks past them.
  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  # Every sync that reaches the store step asks Claude who is away. Nothing here cares about the
  # answer, so every title comes back a plain event; the point is that the success path runs for
  # real rather than limping through the classifier's missing-key failure.
  before { stub_claude_for_titles({}) }

  it "enqueues on the default queue" do
    expect { described_class.perform_later }
      .to have_enqueued_job(described_class).on_queue("default")
  end

  it "syncs every enabled connection and skips disabled ones" do
    enabled = create(:calendar_connection)
    disabled = create(:calendar_connection, disabled_at: Time.current)
    stub_request(:get, enabled.ical_url).to_return(status: 200, body: file_fixture("ics/all_day_single.ics").read)

    described_class.perform_now

    expect(enabled.reload.last_synced_at).to be_present
    expect(disabled.reload.last_synced_at).to be_nil
    expect(a_request(:get, disabled.ical_url)).not_to have_been_made
  end

  it "carries on past a connection that raises" do
    first = create(:calendar_connection)
    second = create(:calendar_connection)
    allow(CalendarSync).to receive(:new).and_call_original
    allow(CalendarSync).to receive(:new).with(first).and_raise(RuntimeError, "boom")
    stub_request(:get, second.ical_url).to_return(status: 200, body: file_fixture("ics/all_day_single.ics").read)
    allow(Rails.error).to receive(:report)

    expect { described_class.perform_now }.not_to raise_error

    expect(second.reload.last_synced_at).to be_present
    expect(Rails.error).to have_received(:report).with(instance_of(RuntimeError), hash_including(context: { calendar_connection_id: first.id }))
  end

  it "is scheduled hourly" do
    config = YAML.load_file(Rails.root.join("config/recurring.yml"), aliases: true)

    expect(config.dig("production", "sync_house_calendars")).to include("class" => "SyncHouseCalendarsJob", "schedule" => "every hour at minute 27")
  end

  # The heartbeat the operator dashboard reads (BLO-1677). This job is a no-op until a house
  # connects a calendar, so without the row "it has not run in days" and "nobody has connected one"
  # look identical on the dashboard.
  describe "the run it writes down" do
    it "records a finished run even with no connections to sync" do
      described_class.perform_now

      expect(JobRun.sole).to have_attributes(
        name: "calendar_sync", succeeded: true, error_class: nil
      )
    end

    # A per-connection failure is rescued inside the loop and never reaches here. This is the sync
    # itself falling over, which must be written down AND still fail the job.
    it "records the failure and still raises when the sync itself falls over" do
      allow(CalendarConnection).to receive(:enabled).and_raise(ActiveRecord::StatementInvalid, "connection lost")

      expect { described_class.perform_now }.to raise_error(ActiveRecord::StatementInvalid)

      expect(JobRun.sole).to have_attributes(
        name: "calendar_sync", succeeded: false, error_class: "ActiveRecord::StatementInvalid"
      )
    end
  end
end
