require "rails_helper"

RSpec.describe CalendarConnection do
  let(:group) { create(:group) }
  let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-0123456789abcdef3f9a/basic.ics" }

  # Brakeman's ValidationRegex check, and it is right: a `\A`-only anchor stops at the first newline,
  # so a link with a second line spliced onto it would be stored.
  it "refuses a link that carries a second line" do
    connection = build(:calendar_connection, group: group, ical_url: "https://calendar.google.com/house.ics\nhttp://evil.example")

    expect(connection).not_to be_valid
    expect(connection.errors[:ical_url]).to include("must be an https link")
  end

  it "refuses a link that is not https" do
    expect(build(:calendar_connection, group: group, ical_url: "http://calendar.google.com/house.ics")).not_to be_valid
  end

  it "masks the link to host plus the tail of the path" do
    connection = create(:calendar_connection, group: group, ical_url: url)

    expect(connection.masked_url).to eq("calendar.google.com/…3f9a/basic.ics")
    expect(connection.masked_url).not_to include("0123456789")
  end

  it "masks a link that has no secret folder above the file" do
    connection = create(:calendar_connection, group: group, ical_url: "https://outlook.office365.com/house.ics")

    expect(connection.masked_url).to eq("outlook.office365.com/…house.ics")
  end

  it "masks the secret when a trailing slash leaves it last" do
    connection = create(:calendar_connection, group: group, ical_url: url.delete_suffix("basic.ics"))

    expect(connection.masked_url).to eq("calendar.google.com/…3f9a")
    expect(connection.masked_url).not_to include("0123456789abcdef")
  end

  it "masks an Apple feed, which ends on the token itself" do
    connection = create(:calendar_connection, group: group,
                        ical_url: "https://p12-caldav.icloud.com/published/2/MTU0NzY4NDQyMTU0NzY4NDR6cMR9Yt7m")

    expect(connection.masked_url).to eq("p12-caldav.icloud.com/…Yt7m")
    expect(connection.masked_url).not_to include("MTU0NzY4NDQy")
  end

  it "masks a Nextcloud feed, whose token is followed by a query string" do
    connection = create(:calendar_connection, group: group,
                        ical_url: "https://cloud.example.com/remote.php/dav/public-calendars/Hs8Kq3Zx9Lm2Rt7v?export")

    expect(connection.masked_url).to eq("cloud.example.com/…Rt7v")
    expect(connection.masked_url).not_to include("Hs8Kq3Zx9Lm2")
  end

  it "returns a placeholder rather than raising when there is no link yet" do
    expect(described_class.new.masked_url).to eq("")
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
