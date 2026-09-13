require "rails_helper"

RSpec.describe CalendarConnect do
  let(:group) { create(:group) }
  let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-abc123/basic.ics" }
  let(:feed) { file_fixture("ics/google_export.ics").read }

  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  # Connect runs the first sync inline, so it reaches Claude. Nothing here asserts a verdict, so an
  # empty map is enough: every title comes back a plain event.
  before { stub_claude_for_titles({}) }

  it "creates the connection and runs the first sync" do
    stub_request(:get, url).to_return(status: 200, body: feed)

    connection = described_class.call(group: group, url: " #{url} ")

    expect(connection).to be_persisted
    expect(connection.ical_url).to eq(url)
    expect(connection.calendar_name).to eq("Park vista")
    expect(connection.calendar_events.count).to eq(1)
    expect(connection.last_synced_at).to eq(Time.current)
  end

  # Validating the link and syncing it are two uses of one body, not two downloads. A busy calendar
  # is the slowest part of the connect request, and Google counts the requests.
  it "downloads the feed once" do
    stub_request(:get, url).to_return(status: 200, body: feed)

    described_class.call(group: group, url: url)

    expect(a_request(:get, url)).to have_been_made.once
  end

  it "replaces an existing connection and its events" do
    old = create(:calendar_connection, group: group)
    create(:calendar_event, calendar_connection: old)
    stub_request(:get, url).to_return(status: 200, body: feed)

    connection = described_class.call(group: group, url: url)

    expect(CalendarConnection.where(group: group).sole).to eq(connection)
    expect(CalendarEvent.where(calendar_connection: old)).to be_empty
  end

  it "rejects bad links with the spec's messages and stores nothing" do
    expect { described_class.call(group: group, url: "http://x.ics") }.to raise_error(described_class::Invalid) { |e|
      expect(e.code).to eq("not_https")
      expect(e.message).to eq("Paste the full https link.")
    }

    stub_request(:get, url).to_timeout
    expect { described_class.call(group: group, url: url) }.to raise_error(described_class::Invalid) { |e|
      expect(e.code).to eq("unreachable")
      expect(e.message).to eq("Couldn't fetch that link. Check it is the secret iCal address and try again.")
    }

    stub_request(:get, url).to_return(status: 200, body: "<html>")
    expect { described_class.call(group: group, url: url) }.to raise_error(described_class::Invalid) { |e|
      expect(e.code).to eq("not_a_calendar")
      expect(e.message).to eq("That link isn't a calendar feed.")
    }

    stub_request(:get, url).to_return(status: 404)
    expect { described_class.call(group: group, url: url) }.to raise_error(described_class::Invalid) { |e|
      expect(e.code).to eq("gone")
      expect(e.message).to eq("Couldn't fetch that link. Check it is the secret iCal address and try again.")
    }

    expect(CalendarConnection.count).to eq(0)
  end
end
