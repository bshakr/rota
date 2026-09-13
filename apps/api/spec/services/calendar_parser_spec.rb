require "rails_helper"

RSpec.describe CalendarParser do
  let(:london) { ActiveSupport::TimeZone["Europe/London"] }
  let(:from) { Date.new(2026, 9, 6) }
  let(:to) { Date.new(2026, 12, 12) }

  def parse(fixture, zone: london, from: self.from, to: self.to)
    described_class.new(file_fixture("ics/#{fixture}").read, zone: zone, from: from, to: to)
  end

  it "reads the calendar name and converts timed events into the group's zone" do
    parser = parse("timed_event.ics")
    dinner, autumn = parser.occurrences.sort_by(&:starts_on)

    expect(parser.calendar_name).to eq("Park Vista")
    expect(dinner).to have_attributes(uid: "dinner@google.com", summary: "House dinner @ home", all_day: false,
                                      starts_on: Date.new(2026, 10, 1), ends_on: Date.new(2026, 10, 1))
    expect(dinner.starts_at.utc).to eq(Time.utc(2026, 10, 1, 18, 0))
    expect(dinner.instance_key).to eq("dinner@google.com#2026-10-01T19:00:00+01:00")
    expect(autumn.starts_at.utc).to eq(Time.utc(2026, 10, 26, 9, 0))
  end

  it "keeps all-day events on their civil dates with an inclusive end" do
    bday, halloween = parse("all_day_single.ics").occurrences.sort_by(&:starts_on)

    expect(bday).to have_attributes(all_day: true, starts_on: Date.new(2026, 9, 23), ends_on: Date.new(2026, 9, 23), starts_at: nil, ends_at: nil)
    expect(bday.instance_key).to eq("bday@google.com#2026-09-23")
    expect(halloween).to have_attributes(starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 9, 25))
  end

  it "spans a multi-day all-day event to the day before its exclusive DTEND" do
    carlisle = parse("all_day_multi.ics").occurrences.sole

    expect(carlisle).to have_attributes(starts_on: Date.new(2026, 9, 16), ends_on: Date.new(2026, 9, 19), all_day: true)
  end

  it "expands a weekly rule inside the window and honours EXDATE" do
    dates = parse("weekly_with_exdate.ics", to: Date.new(2026, 10, 13)).occurrences.map(&:starts_on)

    expect(dates).to eq([ Date.new(2026, 9, 15), Date.new(2026, 9, 29), Date.new(2026, 10, 6), Date.new(2026, 10, 13) ])
  end

  it "applies RECURRENCE-ID overrides and drops cancelled instances" do
    occurrences = parse("override_and_cancelled.ics").occurrences.sort_by(&:starts_on)

    expect(occurrences.map(&:starts_on)).to eq([ Date.new(2026, 9, 14), Date.new(2026, 9, 21), Date.new(2026, 10, 5) ])
    moved = occurrences.find { |o| o.starts_on == Date.new(2026, 9, 21) }
    expect(moved.summary).to eq("House meeting (moved)")
    expect(moved.starts_at.in_time_zone(london).hour).to eq(20)
    expect(moved.instance_key).to eq("meeting@google.com#2026-09-21T19:30:00+01:00")
  end

  # icalendar-recurrence expands instances into plain UTC times, so the key has to be restamped in
  # the event's own zone. Stamping in the group's zone instead would stop a RECURRENCE-ID override
  # matching the instance it replaces for every group outside the feed's zone.
  it "keys instances in the feed's zone, so a group elsewhere still matches the same overrides" do
    occurrences = parse("override_and_cancelled.ics", zone: ActiveSupport::TimeZone["Pacific/Auckland"]).occurrences

    expect(occurrences.map(&:instance_key)).to contain_exactly("meeting@google.com#2026-09-14T19:30:00+01:00",
                                                               "meeting@google.com#2026-09-21T19:30:00+01:00",
                                                               "meeting@google.com#2026-10-05T19:30:00+01:00")
    expect(occurrences.map(&:summary)).to include("House meeting (moved)")
  end

  it "reads floating times in X-WR-TIMEZONE and Z times as UTC" do
    auckland_group = ActiveSupport::TimeZone["Pacific/Auckland"]
    floating, utc = parse("floating_with_wr_timezone.ics", zone: auckland_group).occurrences.sort_by(&:uid)

    expect(floating.starts_at.utc).to eq(Time.utc(2026, 9, 12, 21, 0))
    expect(floating.starts_on).to eq(Date.new(2026, 9, 13))
    expect(utc.starts_at.utc).to eq(Time.utc(2026, 9, 13, 12, 0))
    expect(utc.starts_on).to eq(Date.new(2026, 9, 14))
  end

  it "keeps only occurrences overlapping the window and ignores unread properties" do
    occurrences = parse("google_export.ics").occurrences

    expect(occurrences.map(&:uid)).to eq([ "greece@google.com" ])
    expect(occurrences.first).to have_attributes(starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1))
  end

  it "truncates long titles to 200 characters and substitutes a blank one" do
    body = file_fixture("ics/all_day_single.ics").read.sub("SUMMARY:Alfie Bday", "SUMMARY:#{'x' * 250}").sub("SUMMARY:Halloween decorating\n", "")
    titles = parse_body(body).occurrences.map(&:summary)

    expect(titles).to contain_exactly("x" * 200, "(untitled)")
  end

  it "raises on a body that is not a calendar" do
    expect { parse("not_a_calendar.html").occurrences }.to raise_error(described_class::NotACalendar)
    expect { described_class.new("", zone: london, from: from, to: to).occurrences }.to raise_error(described_class::NotACalendar)
  end

  def parse_body(body)
    described_class.new(body, zone: london, from: from, to: to)
  end
end
