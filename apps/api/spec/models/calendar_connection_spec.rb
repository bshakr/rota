require "rails_helper"

RSpec.describe CalendarConnection do
  let(:group) { create(:group) }
  let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-0123456789abcdef3f9a/basic.ics" }

  it "masks the link to host plus the tail of the path" do
    connection = create(:calendar_connection, group: group, ical_url: url)

    expect(connection.masked_url).to eq("calendar.google.com/…f3f9a/basic.ics")
    expect(connection.masked_url).not_to include("0123456789")
  end

  it "allows one calendar per group" do
    create(:calendar_connection, group: group)

    expect { create(:calendar_connection, group: group) }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "records failures, disables when told, and clears on success" do
    connection = create(:calendar_connection, group: group)

    connection.record_failure!("Couldn't reach the calendar.")
    expect(connection.reload).to have_attributes(consecutive_failures: 1, last_error: "Couldn't reach the calendar.", disabled_at: nil)
    expect(connection.failing?).to be(false)

    2.times { connection.record_failure!("Couldn't reach the calendar.") }
    expect(connection.reload.failing?).to be(true)

    connection.record_failure!("Google says this link no longer works. Paste a new secret address.", disable: true)
    expect(connection.reload.disabled_at).to be_present
    expect(described_class.enabled).not_to include(connection)

    connection.record_success!(etag: "abc", calendar_name: "Park Vista", events_count: 12)
    expect(connection.reload).to have_attributes(consecutive_failures: 0, last_error: nil, disabled_at: nil, etag: "abc", calendar_name: "Park Vista", events_count: 12)
    expect(connection.last_synced_at).to be_present
  end

  it "counts the events still waiting for a verdict" do
    connection = create(:calendar_connection, group: group)
    create(:calendar_event, calendar_connection: connection)
    create(:calendar_event, calendar_connection: connection, classified_at: nil)

    expect(connection.unclassified_count).to eq(1)
  end

  it "deletes its events with the group" do
    connection = create(:calendar_connection, group: group)
    create(:calendar_event, calendar_connection: connection)

    expect { group.destroy! }.to change(CalendarEvent, :count).by(-1)
  end
end
