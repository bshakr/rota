require "rails_helper"

RSpec.describe CalendarSync do
  let(:group) { create(:group, timezone: "Europe/London") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }
  let(:connection) { create(:calendar_connection, group: group) }
  let(:feed) { file_fixture("ics/google_export.ics").read }

  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  # Every example here runs a real sync, so every example needs an answer from Claude. WebMock takes
  # the last matching stub, so an example that wants a different answer simply restubs.
  before { stub_claude_for_titles("Alfie in Greece (Song Leader Retreat)" => [ "away", [ alfie.id ], "Alfie, six nights in Greece" ]) }

  def stub_feed(body, status: 200, headers: {})
    stub_request(:get, connection.ical_url).to_return(status: status, body: body, headers: headers)
  end

  # A calendar of all-day entries, one per day from `start`, for the chunking example. Written here
  # rather than as a fixture because the only thing that matters about it is how many titles it has.
  def feed_of(titles, start: Date.new(2026, 9, 15))
    events = titles.each_with_index.map do |title, index|
      day = start + index
      "BEGIN:VEVENT\nDTSTART;VALUE=DATE:#{day.strftime('%Y%m%d')}\n" \
        "DTEND;VALUE=DATE:#{(day + 1).strftime('%Y%m%d')}\nUID:bulk-#{index}@google.com\n" \
        "SUMMARY:#{title}\nEND:VEVENT\n"
    end
    "BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:Park vista\n#{events.join}END:VCALENDAR\n"
  end

  it "stores occurrences inside the window, asks Claude who is away, and records success" do
    stub_feed(feed, headers: { "ETag" => "\"v1\"" })

    described_class.new(connection).call

    event = connection.calendar_events.sole
    expect(event).to have_attributes(uid: "greece@google.com", kind: "away", reason: "Alfie, six nights in Greece",
                                     starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1))
    expect(event.fingerprint).to be_present
    expect(event.classified_at).to eq(Time.current)
    expect(event.members).to eq([ alfie ])
    expect(connection.reload).to have_attributes(calendar_name: "Park vista", events_count: 1, etag: "\"v1\"", consecutive_failures: 0, last_error: nil)
    expect(connection.last_synced_at).to eq(Time.current)
  end

  it "parses nothing on 304, leaving the stored events and last_synced_at alone" do
    connection.update!(etag: "\"v1\"", last_synced_at: 1.hour.ago)
    stub_feed("", status: 304)

    described_class.new(connection).call

    expect(connection.reload.last_fetched_at).to eq(Time.current)
    expect(connection.last_synced_at).to eq(1.hour.ago)
  end

  # A 304 means Google answered and the calendar has not changed, which is a healthy connection.
  # Leaving the counter alone would keep the dashboard saying "House calendar isn't syncing" every
  # hour until somebody happened to edit the calendar.
  it "clears a run of failures on 304, because the fetch succeeded" do
    event = create(:calendar_event, calendar_connection: connection)
    connection.update!(etag: "\"v1\"", consecutive_failures: 3, last_error: "Couldn't reach the calendar.",
                       disabled_at: 2.days.ago)
    stub_feed("", status: 304)

    described_class.new(connection).call

    expect(connection.reload).to have_attributes(consecutive_failures: 0, last_error: nil, last_fetched_at: Time.current)
    # Still disabled: only "Sync now" and a new link lift that, and neither is a 304.
    expect(connection.disabled_at).to eq(2.days.ago)
    expect(connection.calendar_events.pluck(:id)).to eq([ event.id ])
    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).not_to have_been_made
  end

  it "syncs a body the caller already downloaded, without fetching again" do
    stub_feed(feed)
    fetched = CalendarFetch.call(connection.ical_url)

    described_class.new(connection).call(fetched: fetched)

    expect(connection.calendar_events.sole.uid).to eq("greece@google.com")
    expect(a_request(:get, connection.ical_url)).to have_been_made.once
  end

  it "removes instances that left the feed, updates retitled ones, keeps keys stable" do
    stub_feed(feed)
    described_class.new(connection).call
    first_id = connection.calendar_events.sole.id

    stub_feed(feed.sub("SUMMARY:Alfie in Greece (Song Leader Retreat)", "SUMMARY:Alfie in Greece (retreat)"))
    described_class.new(connection).call
    expect(connection.calendar_events.sole).to have_attributes(id: first_id, summary: "Alfie in Greece (retreat)")

    stub_feed(feed.sub(/BEGIN:VEVENT.*?greece@google.com.*?END:VEVENT\n/m, ""))
    described_class.new(connection).call
    expect(connection.calendar_events.count).to eq(0)
    expect(connection.reload.events_count).to eq(0)
  end

  # A feed is remote input and nothing stops one naming the same instance twice. Postgres will not
  # let an upsert touch a row twice in one statement, and a crash here would escape the promise that
  # a bad feed is recorded on the connection rather than raised at the job.
  it "stores one row when the feed names the same instance twice" do
    twice = <<~ICS
      BEGIN:VEVENT
      DTSTART;VALUE=DATE:20260920
      DTEND;VALUE=DATE:20260921
      UID:twice@google.com
      SUMMARY:Bins out
      END:VEVENT
      BEGIN:VEVENT
      DTSTART;VALUE=DATE:20260920
      DTEND;VALUE=DATE:20260921
      UID:twice@google.com
      SUMMARY:Bins out again
      END:VEVENT
    ICS
    stub_feed(feed.sub("END:VCALENDAR", "#{twice}END:VCALENDAR"))

    described_class.new(connection).call

    expect(connection.calendar_events.where(uid: "twice@google.com").sole.summary).to eq("Bins out")
    expect(connection.reload).to have_attributes(events_count: 2, last_error: nil)
  end

  # The stored window reaches seven days behind today so a trip already under way keeps its row and
  # its away match, but the settings card spends events_count on "{n} events in the next 90 days".
  # Counting every stored row told the admin about entries that finished last week.
  it "counts only entries that have not finished, which is what the card claims to count" do
    past = <<~ICS
      BEGIN:VEVENT
      DTSTART;VALUE=DATE:20260908
      DTEND;VALUE=DATE:20260910
      UID:over@google.com
      SUMMARY:Bins out
      END:VEVENT
      BEGIN:VEVENT
      DTSTART;VALUE=DATE:20260911
      DTEND;VALUE=DATE:20260915
      UID:running@google.com
      SUMMARY:Scaffolding up
      END:VEVENT
    ICS
    stub_feed(feed.sub("END:VCALENDAR", "#{past}END:VCALENDAR"))

    described_class.new(connection).call

    # All three rows are stored: the finished one is still inside the 97-day window.
    expect(connection.calendar_events.count).to eq(3)
    # Counted: the Greece trip in the future and the scaffolding that is still up today. Not the
    # bins, which ended on the 9th and today is the 13th.
    expect(connection.reload.events_count).to eq(2)
  end

  it "reuses the stored verdict and asks Claude nothing on a second sync" do
    stub_feed(feed)

    2.times { described_class.new(connection).call }

    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).to have_been_made.once
    expect(connection.calendar_events.sole).to have_attributes(kind: "away")
  end

  it "asks again when a member is renamed, because the fingerprint changes" do
    stub_feed(feed)
    described_class.new(connection).call
    alfie.update!(name: "Alfred")

    described_class.new(connection).call

    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).to have_been_made.twice
  end

  it "stores the events pending when Claude fails, and still records the sync as a success" do
    stub_feed(feed)
    # A revoked key. The SDK does not retry a 401, so this example does not sleep through two backoffs.
    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(status: 401, body: "{}")

    described_class.new(connection).call

    event = connection.calendar_events.sole
    expect(event).to have_attributes(kind: "event", classified_at: nil, reason: nil)
    expect(event.members).to be_empty
    expect(connection.reload).to have_attributes(consecutive_failures: 0, last_error: nil, events_count: 1)
    expect(connection.unclassified_count).to eq(1)
  end

  # Spec 7.4 and CalendarClassifier::Failed#verdicts: a chunk that failed must not throw away the
  # chunks that worked. 51 unique titles is two chunks, and only the second one fails.
  it "keeps the verdicts an earlier chunk earned when a later chunk fails" do
    stub_feed(feed_of(Array.new(51) { |n| "Trip #{n}" }))
    stub_claude_key
    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return do |request|
      items = JSON.parse(JSON.parse(request.body).dig("messages", 0, "content"))
      if items.size == CalendarClassifier::BATCH_SIZE
        claude_reply(items.map { |item| { ref: item["ref"], kind: "event", member_ids: [], reason: "a chore" } })
      else
        { status: 500, body: "{}" }
      end
    end

    expect(Rails.error).to receive(:report)
      .with(an_instance_of(CalendarClassifier::Failed),
            context: { calendar_connection_id: connection.id },
            source: "rotamonster.calendar_classifier")
      .and_call_original

    described_class.new(connection).call

    expect(connection.calendar_events.classified.count).to eq(50)
    expect(connection.calendar_events.pending.pluck(:summary)).to eq([ "Trip 50" ])
    expect(connection.reload).to have_attributes(events_count: 51, consecutive_failures: 0, last_error: nil)
    expect(connection.unclassified_count).to eq(1)
  end

  it "retries the pending fingerprint next time, and stops once it has a verdict" do
    stub_feed(feed)
    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(status: 401, body: "{}")
    described_class.new(connection).call

    stub_feed(feed)
    stub_claude_for_titles("Alfie in Greece (Song Leader Retreat)" => [ "away", [ alfie.id ], "Alfie, six nights in Greece" ])
    described_class.new(connection).call
    described_class.new(connection).call

    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).to have_been_made.twice
    expect(connection.calendar_events.sole).to have_attributes(kind: "away", reason: "Alfie, six nights in Greece")
    expect(connection.calendar_events.pending).to be_empty
  end

  it "records a reset link and disables after three, keeping stale events" do
    stub_feed(feed)
    described_class.new(connection).call
    stub_feed("", status: 404)

    3.times { described_class.new(connection).call }

    expect(connection.reload).to have_attributes(consecutive_failures: 3, last_error: "Google says this link no longer works. Paste a new secret address.")
    expect(connection.disabled_at).to be_present
    expect(connection.calendar_events.count).to eq(1)
  end

  it "records other failures in plain words and disables after 48" do
    stub_feed("", status: 503)
    described_class.new(connection).call
    expect(connection.reload).to have_attributes(consecutive_failures: 1, last_error: "Couldn't reach the calendar.", disabled_at: nil)

    stub_feed("<html>", status: 200)
    described_class.new(connection).call
    expect(connection.reload.last_error).to eq("That link isn't a calendar feed.")

    connection.update!(consecutive_failures: 47)
    stub_feed("", status: 503)
    described_class.new(connection).call
    expect(connection.reload.disabled_at).to be_present
  end

  # The link is a credential: anyone holding it can read the house's calendar.
  it "names the connection but never the link, in the log or in what the admin reads" do
    stub_feed("", status: 503)
    warnings = []
    allow(Rails.logger).to receive(:warn) { |line| warnings << line.to_s }

    described_class.new(connection).call

    expect(warnings.join("\n")).to include("connection #{connection.id}")
    expect(warnings.join("\n")).not_to include(connection.ical_url)
    expect(connection.reload.last_error).not_to include(connection.ical_url)
  end
end
