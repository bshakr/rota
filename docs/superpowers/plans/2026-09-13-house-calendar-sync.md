# House Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin connect the house's shared Google Calendar by its private iCal link, keep a fresh copy of the next 90 days of events on the server, infer who is away from event titles, and show events and away dates on the member dashboard feed.

**Architecture:** Rails owns the data: a `calendar_connections` row per group (the link plus sync bookkeeping) and `calendar_events` rows (one per expanded occurrence) refreshed by an hourly Solid Queue job through `CalendarFetch` → `CalendarParser` → `AwayClassifier` → `CalendarSync`. Admin endpoints under `/api/group/calendar` connect, sync, preview and disconnect; the member schedule endpoint from BLO-1666 gains an `events` array; the Next.js feed interleaves events and the hand-off ranking gains an "Away" group.

**Tech Stack:** Rails 8.1 (RSpec, FactoryBot, WebMock, Solid Queue, Net::HTTP), gems `icalendar` ~> 2.12 and `icalendar-recurrence` ~> 1.2, Next.js app with shadcn/ui, react-hook-form, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-house-calendar-sync-design.md` (this plan argues from it; read both). Also read `docs/superpowers/specs/2026-09-13-member-dashboard-feed-design.md` (BLO-1666), whose section 9 reserves the hooks Tasks 11–13 fill.

## Global Constraints

- Work on branch `BLO-1667-house-calendar-sync` in the worktree `.koh/BLO-1667-house-calendar-sync`. Run tests from `apps/api` (`bundle exec rspec <file>`; `bin/ci` before a PR) and `apps/web` (`npx vitest run <file>`; `npm run ci` before a PR).
- Tasks 11–13 modify files that BLO-1666 creates. Rebase onto `origin/main` after BLO-1666 merges before starting them, and read the merged `schedule-view.ts`, `cover-ranking.ts`, `member-feed.tsx`, `people-strip.tsx`, `hand-off-sheet.tsx` first; the names below follow the BLO-1666 spec and may differ slightly in the merged code. Adapt to what is there.
- HTTPS only for calendar links. Open timeout 5s, read timeout 15s, body cap 5 MB, at most two HTTPS redirects.
- Expansion window: `group.today - 7.days` to `group.today + 90.days`.
- Only `SUMMARY`, `UID`, `DTSTART`, `DTEND`, `RRULE`, `EXDATE`, `RECURRENCE-ID`, `STATUS`, `X-WR-CALNAME`, `X-WR-TIMEZONE` are read from a feed. Nothing else is stored.
- The stored link is a credential: never returned by the API, never logged, never pre-filled into a form. `ical_url` joins `config.filter_parameters`.
- `kind` is exactly `"event"` or `"away"`. Titles are stored as received, truncated to 200 characters.
- Copy uses no em dashes. UI copy is in the spec; copy it verbatim.
- Every commit message starts with `BLO-1667:`. Two PRs: Tasks 1–10 (backend plus admin settings), Tasks 11–13 (member integration).

## File structure

Rails (`apps/api`)
- `db/migrate/<timestamp>_create_calendar_sync.rb`: three tables.
- `app/models/calendar_connection.rb`: the link, bookkeeping, `masked_url`, `enabled` scope, failure recording.
- `app/models/calendar_event.rb`, `app/models/calendar_event_member.rb`: occurrences and away matches.
- `app/services/calendar_fetch.rb`: HTTP only.
- `app/services/calendar_parser.rb`: ICS text → `Occurrence` structs in the group's zone.
- `app/services/away_classifier.rb`: title → `kind` and matched members.
- `app/services/calendar_sync.rb`: fetch, parse, classify, upsert, prune, bookkeeping.
- `app/services/calendar_connect.rb`: validate a pasted link, create the connection, first sync.
- `app/jobs/sync_house_calendars_job.rb` and `config/recurring.yml`.
- `app/controllers/api/group_calendar_controller.rb`, routes, `app/serializers/calendar_connection_serializer.rb`, `app/serializers/calendar_event_serializer.rb`, `GroupSerializer` gains `calendar`.
- `app/controllers/api/member_schedule_controller.rb` (from BLO-1666) gains `events`.
- `spec/fixtures/ics/*.ics`, specs beside each unit.

Web (`apps/web`)
- `src/lib/api/types.ts`: `CalendarSummary`, `CalendarEventItem`, `CalendarConnectResponse`, `CalendarEventsResponse`, `Group.calendar`, `MemberScheduleResponse.events`.
- `src/lib/api/admin.ts`: `connectCalendar`, `syncCalendar`, `disconnectCalendar`, `listCalendarEvents`.
- `src/app/(admin)/dashboard/actions.ts`: three server actions.
- `src/app/(admin)/dashboard/_components/house-calendar-settings.tsx`: the settings section; mounted from `group-settings.tsx`.
- `src/lib/dashboard.ts`: the `calendar-sync` warning.
- `src/app/(member)/s/[token]/schedule-view.ts` and `cover-ranking.ts` (from BLO-1666): events and away.

Parallel groups: A = Task 1. B = Tasks 2, 3, 4 (independent of A and of each other). C = Tasks 5, 6, 7 (need A and B). D = Tasks 8, 9, 10 (need 7 for the API shape; the web types can be written from the spec first). E = Tasks 11, 12, 13 (need A, 5, and BLO-1666 merged).

---

### Task 1: Migration, models, factories

**Files:**
- Create: `apps/api/db/migrate/20260914090000_create_calendar_sync.rb`
- Create: `apps/api/app/models/calendar_connection.rb`, `apps/api/app/models/calendar_event.rb`, `apps/api/app/models/calendar_event_member.rb`
- Modify: `apps/api/app/models/group.rb` (add `has_one :calendar_connection, dependent: :destroy`)
- Create: `apps/api/spec/factories/calendar_connections.rb`, `apps/api/spec/factories/calendar_events.rb`
- Test: `apps/api/spec/models/calendar_connection_spec.rb`

**Interfaces:**
- Produces: `CalendarConnection` (`group`, `calendar_events`, `ical_url`, `calendar_name`, `etag`, `last_modified`, `last_fetched_at`, `last_synced_at`, `last_error`, `consecutive_failures`, `disabled_at`, `events_count`; scope `enabled`; `#masked_url`; `#failing?`; `#record_failure!(message, disable: false)`; `#record_success!(**attrs)`), `CalendarEvent` (`calendar_connection`, `members` through `calendar_event_members`; `KINDS = %w[event away]`; scope `overlapping(from, to)`), `CalendarEventMember`.

- [ ] **Step 1: Write the failing model spec**

```ruby
# apps/api/spec/models/calendar_connection_spec.rb
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

  it "deletes its events with the group" do
    connection = create(:calendar_connection, group: group)
    create(:calendar_event, calendar_connection: connection)

    expect { group.destroy! }.to change(CalendarEvent, :count).by(-1)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bundle exec rspec spec/models/calendar_connection_spec.rb`
Expected: FAIL, `uninitialized constant CalendarConnection`.

- [ ] **Step 3: Write the migration**

```ruby
# apps/api/db/migrate/20260914090000_create_calendar_sync.rb
class CreateCalendarSync < ActiveRecord::Migration[8.1]
  def change
    create_table :calendar_connections do |t|
      t.references :group, null: false, foreign_key: true, index: { unique: true }
      t.string :ical_url, null: false
      t.string :calendar_name
      t.string :etag
      t.string :last_modified
      t.datetime :last_fetched_at
      t.datetime :last_synced_at
      t.string :last_error
      t.integer :consecutive_failures, null: false, default: 0
      t.datetime :disabled_at
      t.integer :events_count, null: false, default: 0
      t.timestamps
    end

    create_table :calendar_events do |t|
      t.references :calendar_connection, null: false, foreign_key: { on_delete: :cascade }
      t.string :uid, null: false
      t.string :instance_key, null: false
      t.string :summary, null: false
      t.date :starts_on, null: false
      t.date :ends_on, null: false
      t.datetime :starts_at
      t.datetime :ends_at
      t.boolean :all_day, null: false, default: false
      t.string :kind, null: false, default: "event"
      t.datetime :synced_at, null: false
      t.timestamps
      t.index %i[calendar_connection_id instance_key], unique: true
      t.index %i[calendar_connection_id starts_on]
      t.check_constraint "kind IN ('event', 'away')", name: "calendar_events_kind_known"
    end

    create_table :calendar_event_members do |t|
      t.references :calendar_event, null: false, foreign_key: { on_delete: :cascade }
      t.references :member, null: false, foreign_key: { on_delete: :cascade }
      t.index %i[calendar_event_id member_id], unique: true
    end
  end
end
```

- [ ] **Step 4: Write the models and factories**

```ruby
# apps/api/app/models/calendar_connection.rb
# One house's link to its shared calendar, plus the bookkeeping the hourly sync needs. The link is a
# credential (anyone holding it can read the calendar) and is treated like a member's access token:
# stored as given, never serialised back out, masked for display, redacted from logs.
class CalendarConnection < ApplicationRecord
  FAILING_AFTER = 3

  belongs_to :group
  has_many :calendar_events, dependent: :delete_all

  validates :ical_url, presence: true, format: { with: %r{\Ahttps://}i, message: "must be an https link" }

  scope :enabled, -> { where(disabled_at: nil) }

  # Host plus the last few characters of the path: enough to recognise the link, not enough to use it.
  def masked_url
    uri = URI.parse(ical_url)
    "#{uri.host}/…#{uri.path.last(14)}"
  rescue URI::InvalidURIError
    "…#{ical_url.last(14)}"
  end

  def failing?
    disabled_at.present? || consecutive_failures >= FAILING_AFTER
  end

  def record_failure!(message, disable: false)
    update!(consecutive_failures: consecutive_failures + 1, last_error: message,
            last_fetched_at: Time.current, disabled_at: disable ? Time.current : disabled_at)
  end

  def record_success!(**attrs)
    update!(attrs.merge(consecutive_failures: 0, last_error: nil, disabled_at: nil,
                        last_fetched_at: Time.current, last_synced_at: Time.current))
  end
end
```

```ruby
# apps/api/app/models/calendar_event.rb
# One occurrence of a calendar entry — a recurring event is many rows, one per expanded instance,
# keyed by `instance_key`. Dates are civil dates in the group's calendar so the member feed and the
# hand-off ranking compare them to `due_on` directly.
class CalendarEvent < ApplicationRecord
  KINDS = %w[event away].freeze

  belongs_to :calendar_connection
  has_many :calendar_event_members, dependent: :delete_all
  has_many :members, through: :calendar_event_members

  validates :uid, :instance_key, :summary, :starts_on, :ends_on, :synced_at, presence: true
  validates :kind, inclusion: { in: KINDS }

  scope :overlapping, ->(from, to) { where("ends_on >= ? AND starts_on <= ?", from, to) }
  scope :away, -> { where(kind: "away") }

  def away? = kind == "away"
end
```

```ruby
# apps/api/app/models/calendar_event_member.rb
class CalendarEventMember < ApplicationRecord
  belongs_to :calendar_event
  belongs_to :member
end
```

In `apps/api/app/models/group.rb`, after `has_many :sms_messages, through: :members`, add:

```ruby
  # The house's shared calendar, if an admin connected one (BLO-1667). Destroying the group takes the
  # link and every synced event with it.
  has_one :calendar_connection, dependent: :destroy
```

```ruby
# apps/api/spec/factories/calendar_connections.rb
FactoryBot.define do
  factory :calendar_connection do
    group
    sequence(:ical_url) { |n| "https://calendar.google.com/calendar/ical/house#{n}%40gmail.com/private-#{SecureRandom.hex(16)}/basic.ics" }
    calendar_name { "Park Vista" }
  end
end
```

```ruby
# apps/api/spec/factories/calendar_events.rb
FactoryBot.define do
  factory :calendar_event do
    calendar_connection
    sequence(:uid) { |n| "uid-#{n}@google.com" }
    instance_key { "#{uid}#2026-09-20" }
    summary { "House dinner at home" }
    starts_on { Date.new(2026, 9, 20) }
    ends_on { Date.new(2026, 9, 20) }
    all_day { true }
    kind { "event" }
    synced_at { Time.current }
  end
end
```

- [ ] **Step 5: Migrate, run the spec, check the schema diff**

Run: `cd apps/api && bin/rails db:migrate && bin/rails db:test:prepare && bundle exec rspec spec/models/calendar_connection_spec.rb`
Expected: PASS (4 examples). Then `git diff db/schema.rb` shows only the three new tables (the dev database is shared across worktrees; if unrelated tables appear, another branch's migration is in your database, see the memory note on schema drift, and revert those hunks).

- [ ] **Step 6: Commit**

```bash
git add apps/api/db apps/api/app/models apps/api/spec/factories apps/api/spec/models/calendar_connection_spec.rb
git commit -m "BLO-1667: calendar connection and event tables"
```

---

### Task 2: CalendarFetch (HTTP only)

**Files:**
- Create: `apps/api/app/services/calendar_fetch.rb`
- Test: `apps/api/spec/services/calendar_fetch_spec.rb`

**Interfaces:**
- Produces: `CalendarFetch.call(url, etag: nil, last_modified: nil)` → `CalendarFetch::Result` (`status` `:ok` or `:not_modified`, `body`, `etag`, `last_modified`). Raises `CalendarFetch::InvalidUrl`, `CalendarFetch::Gone` (401/403/404/410), `CalendarFetch::Unreachable` (other non-2xx, network, timeout, TLS), `CalendarFetch::TooLarge` (over `MAX_BYTES`). All errors inherit `CalendarFetch::Error` and never carry the URL in their message.

- [ ] **Step 1: Write the failing spec**

```ruby
# apps/api/spec/services/calendar_fetch_spec.rb
require "rails_helper"

RSpec.describe CalendarFetch do
  let(:url) { "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" }
  let(:ics) { "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }

  it "returns the body and caching headers" do
    stub_request(:get, url).to_return(status: 200, body: ics, headers: { "ETag" => "\"v1\"", "Last-Modified" => "Sun, 13 Sep 2026 10:00:00 GMT" })

    result = described_class.call(url)

    expect(result.status).to eq(:ok)
    expect(result.body).to eq(ics)
    expect(result.etag).to eq("\"v1\"")
    expect(result.last_modified).to eq("Sun, 13 Sep 2026 10:00:00 GMT")
  end

  it "sends conditional headers and reports not modified" do
    stub_request(:get, url).with(headers: { "If-None-Match" => "\"v1\"", "If-Modified-Since" => "Sun, 13 Sep 2026 10:00:00 GMT" }).to_return(status: 304)

    result = described_class.call(url, etag: "\"v1\"", last_modified: "Sun, 13 Sep 2026 10:00:00 GMT")

    expect(result.status).to eq(:not_modified)
    expect(result.body).to be_nil
  end

  it "refuses non-https links without a request" do
    expect { described_class.call("http://calendar.google.com/x.ics") }.to raise_error(described_class::InvalidUrl)
    expect { described_class.call("not a url") }.to raise_error(described_class::InvalidUrl)
    expect(a_request(:get, /.*/)).not_to have_been_made
  end

  it "raises Gone for a reset link" do
    stub_request(:get, url).to_return(status: 404)

    expect { described_class.call(url) }.to raise_error(described_class::Gone)
  end

  it "raises Unreachable on server errors and timeouts, without the url in the message" do
    stub_request(:get, url).to_return(status: 503)
    expect { described_class.call(url) }.to raise_error(described_class::Unreachable) { |e| expect(e.message).not_to include("private-abc") }

    stub_request(:get, url).to_timeout
    expect { described_class.call(url) }.to raise_error(described_class::Unreachable)
  end

  it "follows one https redirect and refuses an http one" do
    stub_request(:get, url).to_return(status: 302, headers: { "Location" => "https://calendar.google.com/moved.ics" })
    stub_request(:get, "https://calendar.google.com/moved.ics").to_return(status: 200, body: ics)
    expect(described_class.call(url).body).to eq(ics)

    stub_request(:get, url).to_return(status: 302, headers: { "Location" => "http://calendar.google.com/moved.ics" })
    expect { described_class.call(url) }.to raise_error(described_class::Unreachable)
  end

  it "aborts past the byte cap" do
    stub_request(:get, url).to_return(status: 200, body: "X" * (described_class::MAX_BYTES + 1))

    expect { described_class.call(url) }.to raise_error(described_class::TooLarge)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bundle exec rspec spec/services/calendar_fetch_spec.rb`
Expected: FAIL, `uninitialized constant CalendarFetch`.

- [ ] **Step 3: Implement**

```ruby
# apps/api/app/services/calendar_fetch.rb
require "net/http"

# Fetches a calendar feed and nothing more. Net::HTTP with explicit timeouts, the same idiom as the
# WorkOS JWKS fetch (app/lib/workos_access_token.rb). Every error is one of the classes below and
# none carries the link in its message: the link is a credential and these messages end up in logs
# and on the admin dashboard.
class CalendarFetch
  class Error < StandardError; end
  class InvalidUrl < Error; end
  class Gone < Error; end
  class Unreachable < Error; end
  class TooLarge < Error; end

  Result = Struct.new(:status, :body, :etag, :last_modified, keyword_init: true)

  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 15
  MAX_BYTES = 5 * 1024 * 1024
  MAX_REDIRECTS = 2
  GONE_STATUSES = %w[401 403 404 410].freeze

  def self.call(url, etag: nil, last_modified: nil)
    new(url, etag: etag, last_modified: last_modified).call
  end

  def initialize(url, etag:, last_modified:)
    @uri = parse(url)
    @etag = etag
    @last_modified = last_modified
  end

  def call
    fetch(@uri, redirects_left: MAX_REDIRECTS)
  rescue Timeout::Error, SocketError, Errno::ECONNREFUSED, Errno::ECONNRESET, Errno::EHOSTUNREACH,
         OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError, IOError => e
    raise Unreachable, "#{e.class.name.demodulize} while fetching the calendar"
  end

  private

  def parse(url)
    uri = URI.parse(url.to_s.strip)
    raise InvalidUrl, "calendar links must be https" unless uri.is_a?(URI::HTTPS) && uri.host.present?

    uri
  rescue URI::InvalidURIError
    raise InvalidUrl, "not a valid link"
  end

  def fetch(uri, redirects_left:)
    request = Net::HTTP::Get.new(uri)
    request["Accept"] = "text/calendar, */*;q=0.5"
    request["User-Agent"] = "RotaMonster/1.0 (+https://rota.monster)"
    request["If-None-Match"] = @etag if @etag.present?
    request["If-Modified-Since"] = @last_modified if @last_modified.present?

    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) do |http|
      http.request(request) do |response|
        case response
        when Net::HTTPNotModified
          return Result.new(status: :not_modified)
        when Net::HTTPRedirection
          raise Unreachable, "too many redirects" if redirects_left.zero?

          location = URI.join(uri, response["Location"].to_s)
          raise Unreachable, "redirected off https" unless location.is_a?(URI::HTTPS)

          return fetch(location, redirects_left: redirects_left - 1)
        when Net::HTTPSuccess
          return Result.new(status: :ok, body: read_capped(response), etag: response["ETag"], last_modified: response["Last-Modified"])
        else
          raise Gone, "calendar responded #{response.code}" if GONE_STATUSES.include?(response.code)

          raise Unreachable, "calendar responded #{response.code}"
        end
      end
    end
  end

  # Stream the body so a wrong link pointing at something huge is abandoned early rather than read.
  def read_capped(response)
    body = +""
    response.read_body do |chunk|
      body << chunk
      raise TooLarge, "calendar feed exceeds #{MAX_BYTES} bytes" if body.bytesize > MAX_BYTES
    end
    body.force_encoding(Encoding::UTF_8)
  end
end
```

- [ ] **Step 4: Run the spec**

Run: `cd apps/api && bundle exec rspec spec/services/calendar_fetch_spec.rb`
Expected: PASS (7 examples). If the redirect test fails because `URI.join` is refused by WebMock for the second stub, check the `Location` handling, not the stub.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/calendar_fetch.rb apps/api/spec/services/calendar_fetch_spec.rb
git commit -m "BLO-1667: CalendarFetch with timeouts, caching headers and a byte cap"
```

---

### Task 3: CalendarParser and ICS fixtures

**Files:**
- Modify: `apps/api/Gemfile` (add `gem "icalendar", "~> 2.12"` and `gem "icalendar-recurrence", "~> 1.2"` after `gem "twilio-ruby"`), `apps/api/Gemfile.lock` via bundle
- Create: `apps/api/app/services/calendar_parser.rb`
- Create: `apps/api/spec/fixtures/ics/timed_event.ics`, `all_day_single.ics`, `all_day_multi.ics`, `weekly_with_exdate.ics`, `override_and_cancelled.ics`, `floating_with_wr_timezone.ics`, `google_export.ics`, `not_a_calendar.html`
- Test: `apps/api/spec/services/calendar_parser_spec.rb`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CalendarParser.new(body, zone:, from:, to:)` with `#calendar_name` (String or nil) and `#occurrences` (Array of `CalendarParser::Occurrence`, keyword struct with `uid`, `instance_key`, `summary`, `starts_on`, `ends_on` (Date, inclusive), `starts_at`, `ends_at` (Time in `zone`, nil when all-day), `all_day`). Raises `CalendarParser::NotACalendar`. `zone` is an `ActiveSupport::TimeZone`; `from`/`to` are Dates.

- [ ] **Step 1: Add the gems and probe the library once**

Run: `cd apps/api && bundle add icalendar --version "~> 2.12" && bundle add icalendar-recurrence --version "~> 1.2"` then `bin/bundler-audit` (expected: no vulnerabilities).

Then run this probe and read the output before writing the parser; it settles how the gem represents the four value shapes the parser must handle:

```bash
cd apps/api && bin/rails runner '
require "icalendar"; require "icalendar/recurrence"
ics = <<~ICS
BEGIN:VCALENDAR
X-WR-CALNAME:Park Vista
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
UID:a
DTSTART;TZID=Europe/London:20260915T190000
DTEND;TZID=Europe/London:20260915T200000
SUMMARY:Creative night
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE;TZID=Europe/London:20260922T190000
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART;VALUE=DATE:20260916
DTEND;VALUE=DATE:20260920
SUMMARY:Alfie away in Carlisle
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART:20260913T120000Z
SUMMARY:Utc event
END:VEVENT
BEGIN:VEVENT
UID:d
DTSTART:20260913T090000
SUMMARY:Floating
END:VEVENT
END:VCALENDAR
ICS
cal = Icalendar::Calendar.parse(ics).first
puts cal.custom_property("X-WR-CALNAME").inspect
cal.events.each do |e|
  puts [e.uid, e.dtstart.class, e.dtstart.ical_params.inspect, e.dtstart.to_s, e.dtend&.to_s, e.rrule.inspect].join(" | ")
end
a = cal.events.find { |e| e.uid == "a" }
a.occurrences_between(Date.new(2026,9,1), Date.new(2026,10,31)).each { |o| puts [o.start_time.class, o.start_time.inspect, o.end_time.inspect].join(" | ") }
'
```

Expected, and what to do if not: the `Z` value's `ical_params` reports `{"tzid"=>"UTC"}` (or an array containing `"UTC"`) and the floating value reports no `tzid` (this is how the parser tells floating from UTC; if both look the same, treat a zero-offset no-tzid value as floating and note it in the parser comment). Occurrences come back with `start_time` as a `Time` or `ActiveSupport::TimeWithZone` carrying the event's own zone, and the EXDATE instance (22 Sep) is absent, leaving 15 and 29 Sep. All-day `dtstart` is an `Icalendar::Values::Date`.

- [ ] **Step 2: Write the fixtures**

```text
# apps/api/spec/fixtures/ics/timed_event.ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
X-WR-CALNAME:Park Vista
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
UID:dinner@google.com
DTSTART;TZID=Europe/London:20261001T190000
DTEND;TZID=Europe/London:20261001T213000
SUMMARY:House dinner @ home
END:VEVENT
BEGIN:VEVENT
UID:autumn@google.com
DTSTART;TZID=Europe/London:20261026T090000
DTEND;TZID=Europe/London:20261026T100000
SUMMARY:After the clocks change
END:VEVENT
END:VCALENDAR
```

```text
# apps/api/spec/fixtures/ics/all_day_single.ics
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:bday@google.com
DTSTART;VALUE=DATE:20260923
DTEND;VALUE=DATE:20260924
SUMMARY:Alfie Bday
END:VEVENT
BEGIN:VEVENT
UID:noend@google.com
DTSTART;VALUE=DATE:20260925
SUMMARY:Halloween decorating
END:VEVENT
END:VCALENDAR
```

```text
# apps/api/spec/fixtures/ics/all_day_multi.ics
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:carlisle@google.com
DTSTART;VALUE=DATE:20260916
DTEND;VALUE=DATE:20260920
SUMMARY:Alfie away in Carlisle (Filming)
END:VEVENT
END:VCALENDAR
```

```text
# apps/api/spec/fixtures/ics/weekly_with_exdate.ics
BEGIN:VCALENDAR
VERSION:2.0
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
UID:creative@google.com
DTSTART;TZID=Europe/London:20260915T190000
DTEND;TZID=Europe/London:20260915T200000
RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z
EXDATE;TZID=Europe/London:20260922T190000
SUMMARY:HoD Creative night
END:VEVENT
END:VCALENDAR
```

```text
# apps/api/spec/fixtures/ics/override_and_cancelled.ics
BEGIN:VCALENDAR
VERSION:2.0
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
UID:meeting@google.com
DTSTART;TZID=Europe/London:20260914T193000
DTEND;TZID=Europe/London:20260914T203000
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:House meeting
END:VEVENT
BEGIN:VEVENT
UID:meeting@google.com
RECURRENCE-ID;TZID=Europe/London:20260921T193000
DTSTART;TZID=Europe/London:20260921T200000
DTEND;TZID=Europe/London:20260921T210000
SUMMARY:House meeting (moved)
END:VEVENT
BEGIN:VEVENT
UID:meeting@google.com
RECURRENCE-ID;TZID=Europe/London:20260928T193000
DTSTART;TZID=Europe/London:20260928T193000
DTEND;TZID=Europe/London:20260928T203000
STATUS:CANCELLED
SUMMARY:House meeting
END:VEVENT
END:VCALENDAR
```

```text
# apps/api/spec/fixtures/ics/floating_with_wr_timezone.ics
BEGIN:VCALENDAR
VERSION:2.0
X-WR-TIMEZONE:Pacific/Auckland
BEGIN:VEVENT
UID:floating@google.com
DTSTART:20260913T090000
DTEND:20260913T100000
SUMMARY:Floating breakfast
END:VEVENT
BEGIN:VEVENT
UID:utc@google.com
DTSTART:20260913T120000Z
DTEND:20260913T130000Z
SUMMARY:Utc lunch
END:VEVENT
END:VCALENDAR
```

```text
# apps/api/spec/fixtures/ics/google_export.ics
BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Park vista
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260925
DTEND;VALUE=DATE:20261002
DTSTAMP:20260913T110000Z
UID:greece@google.com
CREATED:20260901T100000Z
DESCRIPTION:Song Leader Retreat\, bring a jumper
LOCATION:Athens
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:Alfie in Greece (Song Leader Retreat)
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260101
DTEND;VALUE=DATE:20260102
UID:old@google.com
SUMMARY:Last New Year
END:VEVENT
END:VCALENDAR
```

```html
<!-- apps/api/spec/fixtures/ics/not_a_calendar.html -->
<!doctype html><html><body><h1>Sign in</h1></body></html>
```

- [ ] **Step 3: Write the failing parser spec**

```ruby
# apps/api/spec/services/calendar_parser_spec.rb
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

    expect(dates).to eq([Date.new(2026, 9, 15), Date.new(2026, 9, 29), Date.new(2026, 10, 6), Date.new(2026, 10, 13)])
  end

  it "applies RECURRENCE-ID overrides and drops cancelled instances" do
    occurrences = parse("override_and_cancelled.ics").occurrences.sort_by(&:starts_on)

    expect(occurrences.map(&:starts_on)).to eq([Date.new(2026, 9, 14), Date.new(2026, 9, 21), Date.new(2026, 10, 5)])
    moved = occurrences.find { |o| o.starts_on == Date.new(2026, 9, 21) }
    expect(moved.summary).to eq("House meeting (moved)")
    expect(moved.starts_at.in_time_zone(london).hour).to eq(20)
    expect(moved.instance_key).to eq("meeting@google.com#2026-09-21T19:30:00+01:00")
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

    expect(occurrences.map(&:uid)).to eq(["greece@google.com"])
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd apps/api && bundle exec rspec spec/services/calendar_parser_spec.rb`
Expected: FAIL, `uninitialized constant CalendarParser`.

- [ ] **Step 5: Implement the parser**

```ruby
# apps/api/app/services/calendar_parser.rb
require "icalendar"
require "icalendar/recurrence"

# ICS text in, occurrences out. Every date the rest of the app sees is a civil date in the group's
# calendar, and every timed instant is a Time in the group's zone, so nothing downstream touches
# iCal's rules again: DTEND is exclusive, all-day values are dates not midnights, recurring events
# are many rows, and an override VEVENT (RECURRENCE-ID) replaces the instance it names.
class CalendarParser
  class NotACalendar < StandardError; end

  Occurrence = Struct.new(:uid, :instance_key, :summary, :starts_on, :ends_on, :starts_at, :ends_at, :all_day, keyword_init: true)

  SUMMARY_LIMIT = 200
  UNTITLED = "(untitled)"

  def initialize(body, zone:, from:, to:)
    @body = body.to_s
    @zone = zone
    @from = from
    @to = to
  end

  def calendar_name
    calendar.custom_property("X-WR-CALNAME").first&.to_s.presence
  end

  def occurrences
    @occurrences ||= build_occurrences
  end

  private

  attr_reader :zone, :from, :to

  def calendar
    @calendar ||= begin
      raise NotACalendar, "no VCALENDAR" unless @body.include?("BEGIN:VCALENDAR")

      Icalendar::Calendar.parse(@body).first or raise NotACalendar, "empty calendar"
    end
  end

  # Floating times (no TZID, no Z) are read in the feed's own zone when it declares one.
  def feed_zone
    @feed_zone ||= ActiveSupport::TimeZone[calendar.custom_property("X-WR-TIMEZONE").first.to_s] || zone
  end

  def build_occurrences
    by_uid = calendar.events.group_by { |event| event.uid.to_s }
    by_uid.flat_map do |uid, events|
      masters, overrides = events.partition { |event| event.recurrence_id.nil? }
      override_by_key = overrides.to_h { |event| [instance_key(uid, event.recurrence_id), event] }

      instances = masters.flat_map { |master| expand(uid, master) }
      instances = instances.map { |occurrence| override_by_key.delete(occurrence.instance_key) || occurrence }
      # An override with no surviving master instance (e.g. the master's rule was edited) still counts.
      instances += override_by_key.values
      instances.filter_map { |instance| instance.is_a?(Occurrence) ? instance : occurrence_from_event(uid, instance, key: instance_key(uid, instance.recurrence_id)) }
    end.select { |occurrence| occurrence.ends_on >= from && occurrence.starts_on <= to }
  end

  def expand(uid, event)
    return [] if cancelled?(event)
    return [occurrence_from_event(uid, event, key: instance_key(uid, event.dtstart))] if event.rrule.blank?

    duration = duration_of(event)
    event.occurrences_between(from - 1, to + 1).map do |occurrence|
      start_value = event.dtstart.is_a?(Icalendar::Values::Date) ? occurrence.start_time.to_date : occurrence.start_time
      build(uid: uid, key: instance_key(uid, start_value), summary: event.summary, start_value: start_value,
            end_value: start_value + duration, all_day: event.dtstart.is_a?(Icalendar::Values::Date))
    end
  end

  def occurrence_from_event(uid, event, key:)
    return nil if cancelled?(event)

    all_day = event.dtstart.is_a?(Icalendar::Values::Date)
    start_value = all_day ? event.dtstart.to_date : local_time(event.dtstart)
    end_value = if event.dtend.nil?
      all_day ? start_value + 1 : start_value
    else
      all_day ? event.dtend.to_date : local_time(event.dtend)
    end
    build(uid: uid, key: key, summary: event.summary, start_value: start_value, end_value: end_value, all_day: all_day)
  end

  # start/end values are Dates for all-day events (end exclusive, per iCal) or Times otherwise.
  def build(uid:, key:, summary:, start_value:, end_value:, all_day:)
    if all_day
      Occurrence.new(uid: uid, instance_key: key, summary: title(summary), all_day: true,
                     starts_on: start_value, ends_on: [end_value - 1, start_value].max, starts_at: nil, ends_at: nil)
    else
      starts_at = start_value.in_time_zone(zone)
      ends_at = end_value.in_time_zone(zone)
      ends_on = ends_at.to_date
      ends_on -= 1 if ends_at > starts_at && ends_at == ends_at.beginning_of_day
      Occurrence.new(uid: uid, instance_key: key, summary: title(summary), all_day: false,
                     starts_on: starts_at.to_date, ends_on: [ends_on, starts_at.to_date].max, starts_at: starts_at, ends_at: ends_at)
    end
  end

  def duration_of(event)
    if event.dtstart.is_a?(Icalendar::Values::Date)
      event.dtend ? (event.dtend.to_date - event.dtstart.to_date).to_i : 1
    else
      event.dtend ? (local_time(event.dtend) - local_time(event.dtstart)) : 0
    end
  end

  # A value with a TZID is read in that zone; `Z` values arrive with tzid "UTC"; a value with neither
  # is floating and read in the feed's declared zone. Reading the components ourselves sidesteps the
  # library's own conversion, which is where DST mistakes creep in.
  def local_time(value)
    tzid = Array(value.ical_params["tzid"]).first.to_s
    source_zone = tzid.present? ? (ActiveSupport::TimeZone[tzid] || zone) : feed_zone
    source_zone.local(value.year, value.month, value.day, value.hour, value.min, value.sec)
  end

  def instance_key(uid, value)
    stamp = case value
            when Icalendar::Values::Date then value.to_date.iso8601
            when Icalendar::Values::DateTime then local_time(value).iso8601
            when Date then value.iso8601
            else value.in_time_zone(zone).iso8601
            end
    "#{uid}##{stamp}"
  end

  def cancelled?(event)
    event.status.to_s.casecmp?("CANCELLED")
  end

  def title(summary)
    summary.to_s.strip.presence&.first(SUMMARY_LIMIT) || UNTITLED
  end
end
```

- [ ] **Step 6: Run the spec and fix against the probe**

Run: `cd apps/api && bundle exec rspec spec/services/calendar_parser_spec.rb`
Expected: PASS (9 examples). The most likely failures and their fixes: (a) the recurrence library returns `start_time` in a different zone than the event's TZID, so the instance key stamp differs by offset: build the key from `occurrence.start_time.in_time_zone(source zone of dtstart)` instead; (b) `custom_property` returns an array of `Icalendar::Values::Text`: `.first.to_s` handles it; (c) the `Z` case reports no tzid: treat a no-tzid value whose `to_time.utc_offset` is zero and whose feed declares `X-WR-TIMEZONE` as floating only when the raw line lacked `Z`, which is not recoverable after parse, so in that case read no-tzid zero-offset values as UTC and adjust the floating spec to a feed without `X-WR-TIMEZONE`. Record whichever branch applied in the parser comment.

- [ ] **Step 7: Commit**

```bash
git add apps/api/Gemfile apps/api/Gemfile.lock apps/api/app/services/calendar_parser.rb apps/api/spec/services/calendar_parser_spec.rb apps/api/spec/fixtures/ics
git commit -m "BLO-1667: CalendarParser expands iCal feeds into civil-date occurrences"
```

---

### Task 4: AwayClassifier

**Files:**
- Create: `apps/api/app/services/away_classifier.rb`
- Test: `apps/api/spec/services/away_classifier_spec.rb`

**Interfaces:**
- Consumes: `Member` records (`id`, `name`).
- Produces: `AwayClassifier.new(members)` with `#classify(summary:, all_day:, starts_on:, ends_on:)` → `Hash` `{ kind: "event" | "away", member_ids: [Integer] }`.

- [ ] **Step 1: Write the failing spec**

```ruby
# apps/api/spec/services/away_classifier_spec.rb
require "rails_helper"

RSpec.describe AwayClassifier do
  let(:group) { create(:group) }
  let!(:bass) { create(:member, group: group, name: "Bass") }
  let!(:eliza) { create(:member, group: group, name: "Eliza") }
  let!(:raph) { create(:member, group: group, name: "Raph") }
  let!(:ciara) { create(:member, group: group, name: "Ciara") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }
  let!(:mic) { create(:member, group: group, name: "Mic") }

  subject(:classifier) { described_class.new(group.members.active) }

  def classify(summary, all_day: true, starts_on: Date.new(2026, 9, 16), ends_on: Date.new(2026, 9, 19))
    classifier.classify(summary: summary, all_day: all_day, starts_on: starts_on, ends_on: ends_on)
  end

  it "recognises the house's own away titles" do
    expect(classify("Alfie away in Carlisle (Filming)")).to eq(kind: "away", member_ids: [alfie.id])
    expect(classify("Ciara – France")).to eq(kind: "away", member_ids: [ciara.id])
    expect(classify("Bass and Eliza France")).to eq(kind: "away", member_ids: [bass.id, eliza.id])
    expect(classify("Bass & Eliza France")).to eq(kind: "away", member_ids: [bass.id, eliza.id])
    expect(classify("Mic Ireland with fam")).to eq(kind: "away", member_ids: [mic.id])
    expect(classify("Alfie in Greece (Song Leader Retreat)")).to eq(kind: "away", member_ids: [alfie.id])
    expect(classify("Away: Raph and Ciara")).to eq(kind: "away", member_ids: [raph.id, ciara.id])
  end

  it "leaves chores, celebrations and non-housemates as events" do
    expect(classify("Raph Bins Out")).to eq(kind: "event", member_ids: [])
    expect(classify("Alfie Bday")).to eq(kind: "event", member_ids: [])
    expect(classify("Naomi's birthday")).to eq(kind: "event", member_ids: [])
    expect(classify("Alfie's birthday")).to eq(kind: "event", member_ids: [])
    expect(classify("Ester in London [ES4C]")).to eq(kind: "event", member_ids: [])
    expect(classify("House dinner @ home", all_day: false)).to eq(kind: "event", member_ids: [])
  end

  it "treats a timed slot on one day as an event, and an overnight timed one as away" do
    expect(classify("Raph – Tummo retreat w Nico", all_day: false, starts_on: Date.new(2026, 9, 26), ends_on: Date.new(2026, 9, 26))).to eq(kind: "event", member_ids: [])
    expect(classify("Raph – Tummo retreat w Nico", all_day: false, starts_on: Date.new(2026, 9, 26), ends_on: Date.new(2026, 9, 27))).to eq(kind: "away", member_ids: [raph.id])
  end

  it "matches whole words only, and full names when first names collide" do
    create(:member, group: group, name: "Mic Taylor")
    collide = described_class.new(group.members.active)

    expect(classify("Raphael – Tummo retreat")).to eq(kind: "event", member_ids: [])
    expect(collide.classify(summary: "Mic Ireland", all_day: true, starts_on: Date.new(2026, 9, 16), ends_on: Date.new(2026, 9, 19))).to eq(kind: "event", member_ids: [])
    expect(collide.classify(summary: "Mic Taylor Ireland", all_day: true, starts_on: Date.new(2026, 9, 16), ends_on: Date.new(2026, 9, 19))[:member_ids]).to eq([group.members.find_by(name: "Mic Taylor").id])
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bundle exec rspec spec/services/away_classifier_spec.rb`
Expected: FAIL, `uninitialized constant AwayClassifier`.

- [ ] **Step 3: Implement**

```ruby
# apps/api/app/services/away_classifier.rb
# Decides whether a calendar title means a housemate is away, the way the house already writes them:
# "Alfie away in Carlisle", "Ciara – France", "Bass and Eliza France". The rule (spec section 7):
# the title starts with one or more housemate names, the entry is all-day or overnight, and the
# rest of the title is not a chore or a celebration. Recomputed on every sync, so a renamed event
# or a renamed member corrects itself within the hour.
class AwayClassifier
  EXCLUSIONS = %w[bin bins birthday bday b-day dinner party meeting clean cleaning rota shift pay rent].freeze
  JOINERS = /\s*(?:,|and|&|\+)\s*/i

  Name = Struct.new(:member_id, :pattern, :length, keyword_init: true)

  def initialize(members)
    @names = build_names(members)
  end

  def classify(summary:, all_day:, starts_on:, ends_on:)
    title = normalise(summary)
    explicit = title.sub!(/\Aaway[:\s-]+/, "") ? true : false
    member_ids, rest = consume_names(title)

    return { kind: "event", member_ids: [] } if member_ids.empty?
    return { kind: "event", member_ids: [] } if excluded?(rest)
    return { kind: "event", member_ids: [] } unless explicit || all_day || ends_on > starts_on

    { kind: "away", member_ids: member_ids }
  end

  private

  def normalise(summary)
    summary.to_s.downcase
      .gsub(/\[[^\]]*\]|\([^)]*\)/, " ")
      .gsub(/[^\p{L}\p{N}\s\-–&+,']/, " ")
      .gsub(/\s+/, " ")
      .strip
  end

  # First names win unless two housemates share one, in which case only the full name counts.
  def build_names(members)
    firsts = members.map { |member| [member, member.name.to_s.split.first.to_s.downcase] }
    counts = firsts.map(&:last).tally
    firsts.flat_map do |member, first|
      full = member.name.to_s.downcase.strip
      candidates = counts[first] > 1 ? [full] : [full, first].uniq
      candidates.reject(&:blank?).map { |name| Name.new(member_id: member.id, pattern: /\A#{Regexp.escape(name)}(?!'s)\b/, length: name.length) }
    end.sort_by { |name| -name.length }
  end

  # Peel "bass and eliza" off the front, longest name first, returning the ids and the remainder.
  def consume_names(title)
    ids = []
    rest = title
    loop do
      name = @names.find { |candidate| rest.match?(candidate.pattern) }
      break unless name

      ids << name.member_id unless ids.include?(name.member_id)
      rest = rest.sub(name.pattern, "").sub(/\A#{JOINERS}/, "").strip
      break unless rest.match?(/\A\p{L}/)
    end
    [ids, rest]
  end

  def excluded?(rest)
    words = rest.scan(/[\p{L}\-]+/)
    words.intersect?(EXCLUSIONS)
  end
end
```

- [ ] **Step 4: Run the spec**

Run: `cd apps/api && bundle exec rspec spec/services/away_classifier_spec.rb`
Expected: PASS (4 examples). If "Bass and Eliza France" yields only Bass, the joiner strip is not running before the second name match; check `consume_names` strips `JOINERS` after each hit.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/away_classifier.rb apps/api/spec/services/away_classifier_spec.rb
git commit -m "BLO-1667: AwayClassifier reads away dates from calendar titles"
```

---

### Task 5: CalendarSync and CalendarConnect

**Files:**
- Create: `apps/api/app/services/calendar_sync.rb`, `apps/api/app/services/calendar_connect.rb`
- Test: `apps/api/spec/services/calendar_sync_spec.rb`, `apps/api/spec/services/calendar_connect_spec.rb`

**Interfaces:**
- Consumes: Task 1 models; `CalendarFetch.call` (Task 2); `CalendarParser` (Task 3); `AwayClassifier` (Task 4).
- Produces: `CalendarSync.new(connection).call` → the reloaded connection; never raises for fetch or parse problems (they are recorded on the connection); `CalendarSync::PAST_DAYS = 7`, `FUTURE_DAYS = 90`; `CalendarSync.window_for(group)` → `[from, to]`. `CalendarConnect.call(group:, url:)` → the created or replaced `CalendarConnection`, already synced; raises `CalendarConnect::Invalid` with `#code` in `%w[not_https unreachable not_a_calendar too_large gone]` and `#message` holding the spec's copy. `CalendarSync::MESSAGES` maps error classes to the admin-facing sentences.

- [ ] **Step 1: Write the failing sync spec**

```ruby
# apps/api/spec/services/calendar_sync_spec.rb
require "rails_helper"

RSpec.describe CalendarSync do
  let(:group) { create(:group, timezone: "Europe/London") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }
  let(:connection) { create(:calendar_connection, group: group) }
  let(:feed) { file_fixture("ics/google_export.ics").read }

  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  def stub_feed(body, status: 200, headers: {})
    stub_request(:get, connection.ical_url).to_return(status: status, body: body, headers: headers)
  end

  it "stores occurrences inside the window, classifies away, and records success" do
    stub_feed(feed, headers: { "ETag" => "\"v1\"" })

    described_class.new(connection).call

    event = connection.calendar_events.sole
    expect(event).to have_attributes(uid: "greece@google.com", kind: "away", starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1))
    expect(event.members).to eq([alfie])
    expect(connection.reload).to have_attributes(calendar_name: "Park vista", events_count: 1, etag: "\"v1\"", consecutive_failures: 0, last_error: nil)
    expect(connection.last_synced_at).to eq(Time.current)
  end

  it "does nothing on 304 except stamp the fetch" do
    connection.update!(etag: "\"v1\"", last_synced_at: 1.hour.ago)
    stub_feed("", status: 304)

    described_class.new(connection).call

    expect(connection.reload.last_fetched_at).to eq(Time.current)
    expect(connection.last_synced_at).to eq(1.hour.ago)
  end

  it "removes instances that left the feed, updates retitled ones, keeps keys stable" do
    stub_feed(feed)
    described_class.new(connection).call
    first_id = connection.calendar_events.sole.id

    stub_feed(feed.sub("SUMMARY:Alfie in Greece (Song Leader Retreat)", "SUMMARY:Alfie in Greece (retreat)") + "")
    described_class.new(connection).call
    expect(connection.calendar_events.sole).to have_attributes(id: first_id, summary: "Alfie in Greece (retreat)")

    stub_feed(feed.sub(/BEGIN:VEVENT.*?greece@google.com.*?END:VEVENT\n/m, ""))
    described_class.new(connection).call
    expect(connection.calendar_events.count).to eq(0)
    expect(connection.reload.events_count).to eq(0)
  end

  it "reclassifies when a member is renamed" do
    stub_feed(feed)
    described_class.new(connection).call
    alfie.update!(name: "Alfred")

    described_class.new(connection).call

    expect(connection.calendar_events.sole).to have_attributes(kind: "event")
    expect(CalendarEventMember.count).to eq(0)
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
end
```

- [ ] **Step 2: Write the failing connect spec**

```ruby
# apps/api/spec/services/calendar_connect_spec.rb
require "rails_helper"

RSpec.describe CalendarConnect do
  let(:group) { create(:group) }
  let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-abc123/basic.ics" }
  let(:feed) { file_fixture("ics/google_export.ics").read }

  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  it "creates the connection and runs the first sync" do
    stub_request(:get, url).to_return(status: 200, body: feed)

    connection = described_class.call(group: group, url: " #{url} ")

    expect(connection).to be_persisted
    expect(connection.ical_url).to eq(url)
    expect(connection.calendar_name).to eq("Park vista")
    expect(connection.calendar_events.count).to eq(1)
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
    expect { described_class.call(group: group, url: "http://x.ics") }.to raise_error(described_class::Invalid) { |e| expect(e.code).to eq("not_https"); expect(e.message).to eq("Paste the full https link.") }

    stub_request(:get, url).to_timeout
    expect { described_class.call(group: group, url: url) }.to raise_error(described_class::Invalid) { |e| expect(e.code).to eq("unreachable"); expect(e.message).to eq("Couldn't fetch that link. Check it is the secret iCal address and try again.") }

    stub_request(:get, url).to_return(status: 200, body: "<html>")
    expect { described_class.call(group: group, url: url) }.to raise_error(described_class::Invalid) { |e| expect(e.code).to eq("not_a_calendar"); expect(e.message).to eq("That link isn't a calendar feed.") }

    stub_request(:get, url).to_return(status: 404)
    expect { described_class.call(group: group, url: url) }.to raise_error(described_class::Invalid) { |e| expect(e.code).to eq("gone") }

    expect(CalendarConnection.count).to eq(0)
  end
end
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd apps/api && bundle exec rspec spec/services/calendar_sync_spec.rb spec/services/calendar_connect_spec.rb`
Expected: FAIL, uninitialized constants.

- [ ] **Step 4: Implement CalendarSync**

```ruby
# apps/api/app/services/calendar_sync.rb
# One pass over one house's calendar: fetch, parse, classify, upsert, prune. Failures are recorded
# on the connection rather than raised, so the hourly job and the admin's "Sync now" both see the
# same plain-words outcome. Stale rows are kept on failure: a calendar that was right yesterday
# beats an empty one.
class CalendarSync
  PAST_DAYS = 7
  FUTURE_DAYS = 90
  DISABLE_AFTER_GONE = 3
  DISABLE_AFTER_ANY = 48

  MESSAGES = {
    CalendarFetch::Gone => "Google says this link no longer works. Paste a new secret address.",
    CalendarFetch::Unreachable => "Couldn't reach the calendar.",
    CalendarFetch::InvalidUrl => "Paste the full https link.",
    CalendarFetch::TooLarge => "The calendar feed is too large to read (over 5 MB).",
    CalendarParser::NotACalendar => "That link isn't a calendar feed."
  }.freeze

  def self.window_for(group)
    today = group.today
    [today - PAST_DAYS, today + FUTURE_DAYS]
  end

  def initialize(connection)
    @connection = connection
  end

  def call
    result = CalendarFetch.call(connection.ical_url, etag: connection.etag, last_modified: connection.last_modified)
    if result.status == :not_modified
      connection.update!(last_fetched_at: Time.current)
      return connection
    end

    from, to = self.class.window_for(group)
    parser = CalendarParser.new(result.body, zone: group.time_zone, from: from, to: to)
    occurrences = parser.occurrences
    store(occurrences)
    connection.record_success!(calendar_name: parser.calendar_name, etag: result.etag, last_modified: result.last_modified, events_count: occurrences.size)
    connection
  rescue CalendarFetch::Error, CalendarParser::NotACalendar => e
    failures = connection.consecutive_failures + 1
    disable = (e.is_a?(CalendarFetch::Gone) && failures >= DISABLE_AFTER_GONE) || failures >= DISABLE_AFTER_ANY
    connection.record_failure!(MESSAGES.fetch(e.class), disable: disable)
    Rails.logger.warn("CalendarSync failed for connection #{connection.id}: #{e.class}: #{e.message}")
    connection
  end

  private

  attr_reader :connection

  def group = connection.group

  def store(occurrences)
    now = Time.current
    classifier = AwayClassifier.new(group.members.active)
    classified = occurrences.map do |occurrence|
      verdict = classifier.classify(summary: occurrence.summary, all_day: occurrence.all_day, starts_on: occurrence.starts_on, ends_on: occurrence.ends_on)
      [occurrence, verdict]
    end

    CalendarEvent.transaction do
      if classified.any?
        rows = classified.map do |occurrence, verdict|
          { calendar_connection_id: connection.id, uid: occurrence.uid, instance_key: occurrence.instance_key,
            summary: occurrence.summary, starts_on: occurrence.starts_on, ends_on: occurrence.ends_on,
            starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, all_day: occurrence.all_day,
            kind: verdict[:kind], synced_at: now, created_at: now, updated_at: now }
        end
        CalendarEvent.upsert_all(rows, unique_by: %i[calendar_connection_id instance_key],
                                       update_only: %i[uid summary starts_on ends_on starts_at ends_at all_day kind synced_at updated_at])
      end
      connection.calendar_events.where("synced_at < ?", now).delete_all

      ids_by_key = connection.calendar_events.pluck(:instance_key, :id).to_h
      CalendarEventMember.where(calendar_event_id: ids_by_key.values).delete_all
      links = classified.flat_map do |occurrence, verdict|
        verdict[:member_ids].map { |member_id| { calendar_event_id: ids_by_key.fetch(occurrence.instance_key), member_id: member_id } }
      end
      CalendarEventMember.insert_all(links) if links.any?
    end
  end
end
```

- [ ] **Step 5: Implement CalendarConnect**

```ruby
# apps/api/app/services/calendar_connect.rb
# The admin pasted a link. Prove it works before storing it: fetch and parse once, and only then
# replace whatever connection the house had. A bad link is an Invalid with the sentence the form
# shows; nothing is written.
class CalendarConnect
  class Invalid < StandardError
    attr_reader :code

    def initialize(code, message)
      @code = code
      super(message)
    end
  end

  CODES = {
    CalendarFetch::InvalidUrl => "not_https",
    CalendarFetch::Unreachable => "unreachable",
    CalendarFetch::TooLarge => "too_large",
    CalendarFetch::Gone => "gone",
    CalendarParser::NotACalendar => "not_a_calendar"
  }.freeze

  def self.call(group:, url:)
    url = url.to_s.strip
    raise Invalid.new("not_https", CalendarSync::MESSAGES[CalendarFetch::InvalidUrl]) unless url.match?(%r{\Ahttps://\S+\z}i)

    result = CalendarFetch.call(url)
    from, to = CalendarSync.window_for(group)
    CalendarParser.new(result.body, zone: group.time_zone, from: from, to: to).occurrences

    connection = CalendarConnection.transaction do
      group.calendar_connection&.destroy!
      group.create_calendar_connection!(ical_url: url)
    end
    CalendarSync.new(connection).call
  rescue CalendarFetch::Error, CalendarParser::NotACalendar => e
    message = e.is_a?(CalendarFetch::Unreachable) ? "Couldn't fetch that link. Check it is the secret iCal address and try again." : CalendarSync::MESSAGES.fetch(e.class)
    raise Invalid.new(CODES.fetch(e.class), message)
  end
end
```

- [ ] **Step 6: Run both specs**

Run: `cd apps/api && bundle exec rspec spec/services/calendar_sync_spec.rb spec/services/calendar_connect_spec.rb`
Expected: PASS (6 + 3 examples). `upsert_all` with `update_only` needs Rails 7.1+; this app is 8.1. If the retitle test fails on `id` stability, the unique index name in `unique_by` must be the column pair exactly as in Task 1.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/calendar_sync.rb apps/api/app/services/calendar_connect.rb apps/api/spec/services/calendar_sync_spec.rb apps/api/spec/services/calendar_connect_spec.rb
git commit -m "BLO-1667: CalendarSync upserts occurrences and CalendarConnect validates a pasted link"
```

---

### Task 6: SyncHouseCalendarsJob and the hourly schedule

**Files:**
- Create: `apps/api/app/jobs/sync_house_calendars_job.rb`
- Modify: `apps/api/config/recurring.yml` (add an entry under `default`)
- Test: `apps/api/spec/jobs/sync_house_calendars_job_spec.rb`

**Interfaces:**
- Consumes: `CalendarConnection.enabled`, `CalendarSync`.
- Produces: `SyncHouseCalendarsJob.perform_now`.

- [ ] **Step 1: Write the failing spec**

```ruby
# apps/api/spec/jobs/sync_house_calendars_job_spec.rb
require "rails_helper"

RSpec.describe SyncHouseCalendarsJob do
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
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bundle exec rspec spec/jobs/sync_house_calendars_job_spec.rb`
Expected: FAIL, `uninitialized constant SyncHouseCalendarsJob`.

- [ ] **Step 3: Implement the job and schedule**

```ruby
# apps/api/app/jobs/sync_house_calendars_job.rb
# Hourly refresh of every connected house calendar — see config/recurring.yml. Idempotent: CalendarSync
# upserts by instance key and prunes what left the feed, so a doubled or missed run costs nothing.
# Same shape as TopUpShiftWindowsJob: one house's bad link must not starve the houses after it.
class SyncHouseCalendarsJob < ApplicationJob
  queue_as :default

  def perform
    CalendarConnection.enabled.includes(:group).find_each do |connection|
      CalendarSync.new(connection).call
    rescue StandardError => e
      Rails.logger.error("SyncHouseCalendarsJob failed for connection #{connection.id}: #{e.class}: #{e.message}")
      Rails.error.report(e, context: { calendar_connection_id: connection.id }, source: "houserota.calendar_sync")
    end
  end
end
```

In `apps/api/config/recurring.yml`, under `default:` after `reminder_sweep`, add:

```yaml
  # Refreshes every connected house calendar (BLO-1667). Google caches the private iCal feed for an
  # hour or two, so anything more frequent buys nothing; minute 27 keeps it clear of the reminder
  # sweep on the hour and the Solid Queue cleanup at minute 12. A no-op until an admin connects one.
  sync_house_calendars:
    class: SyncHouseCalendarsJob
    queue: default
    schedule: every hour at minute 27
```

- [ ] **Step 4: Run the spec**

Run: `cd apps/api && bundle exec rspec spec/jobs/sync_house_calendars_job_spec.rb`
Expected: PASS (3 examples).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/jobs/sync_house_calendars_job.rb apps/api/config/recurring.yml apps/api/spec/jobs/sync_house_calendars_job_spec.rb
git commit -m "BLO-1667: hourly SyncHouseCalendarsJob"
```

---

### Task 7: Admin calendar endpoints, serializers, throttle, log redaction

**Files:**
- Create: `apps/api/app/controllers/api/group_calendar_controller.rb`, `apps/api/app/serializers/calendar_connection_serializer.rb`, `apps/api/app/serializers/calendar_event_serializer.rb`
- Modify: `apps/api/config/routes.rb` (inside `namespace :api`, after `resource :group ...`), `apps/api/app/serializers/group_serializer.rb`, `apps/api/config/initializers/filter_parameter_logging.rb`, `apps/api/config/initializers/rack_attack.rb`
- Test: `apps/api/spec/requests/api/group_calendar_spec.rb`, extend `apps/api/spec/requests/api/group_spec.rb`

**Interfaces:**
- Consumes: Task 5 services, Task 1 models.
- Produces: `GET /api/group` → `group.calendar` (`null` or `{ calendar_name, masked_url, events_count, last_synced_at, last_error, failing }`); `PUT /api/group/calendar` `{ ical_url }` → `{ calendar, events_preview: [CalendarEvent...] }` or 422 `{ error: "invalid", fields: { ical_url: [message] }, code }`; `POST /api/group/calendar/sync` → `{ calendar }`; `DELETE /api/group/calendar` → 204; `GET /api/group/calendar/events?days=30` → `{ events: [...] }`. Event JSON: `{ id, title, starts_on, ends_on, all_day, start_time, kind, member_ids }` (`start_time` "HH:MM" in the group's zone or null).

- [ ] **Step 1: Write the failing request specs**

```ruby
# apps/api/spec/requests/api/group_calendar_spec.rb
require "rails_helper"

RSpec.describe "Api::GroupCalendar" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT", timezone: "Europe/London") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }
  let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-abc123def456/basic.ics" }
  let(:feed) { file_fixture("ics/google_export.ics").read }
  def headers = workos_headers(org_id: group.workos_organization_id)

  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  describe "PUT /api/group/calendar" do
    it "connects, syncs, and returns the summary and a preview without the link" do
      stub_request(:get, url).to_return(status: 200, body: feed)

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["calendar"]).to include("calendar_name" => "Park vista", "masked_url" => "calendar.google.com/…def456/basic.ics", "events_count" => 1, "failing" => false, "last_error" => nil)
      expect(body["events_preview"].first).to include("title" => "Alfie in Greece (Song Leader Retreat)", "kind" => "away", "member_ids" => [alfie.id], "starts_on" => "2026-09-25", "ends_on" => "2026-10-01", "all_day" => true, "start_time" => nil)
      expect(response.body).not_to include("abc123def456")
    end

    it "rejects a bad link with a field error" do
      put "/api/group/calendar", params: { ical_url: "http://nope" }, headers: headers

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body).to include("error" => "invalid", "code" => "not_https", "fields" => { "ical_url" => ["Paste the full https link."] })
      expect(CalendarConnection.count).to eq(0)
    end

    it "is refused without a token" do
      put "/api/group/calendar", params: { ical_url: url }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/group/calendar/sync" do
    it "syncs the caller's connection only" do
      connection = create(:calendar_connection, group: group, ical_url: url)
      other = create(:calendar_connection)
      stub_request(:get, url).to_return(status: 200, body: feed)

      post "/api/group/calendar/sync", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["calendar"]).to include("events_count" => 1)
      expect(connection.reload.last_synced_at).to be_present
      expect(other.reload.last_synced_at).to be_nil
      expect(a_request(:get, other.ical_url)).not_to have_been_made
    end

    it "re-enables a disabled connection" do
      create(:calendar_connection, group: group, ical_url: url, disabled_at: Time.current, consecutive_failures: 5)
      stub_request(:get, url).to_return(status: 200, body: feed)

      post "/api/group/calendar/sync", headers: headers

      expect(group.reload.calendar_connection).to have_attributes(disabled_at: nil, consecutive_failures: 0)
    end

    it "is 404 when nothing is connected" do
      post "/api/group/calendar/sync", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET /api/group/calendar/events" do
    it "lists the next N days for this group" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection, summary: "Soon", starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))
      create(:calendar_event, calendar_connection: connection, summary: "Later", starts_on: Date.new(2026, 11, 20), ends_on: Date.new(2026, 11, 20))
      create(:calendar_event, calendar_connection: connection, summary: "Gone", starts_on: Date.new(2026, 9, 1), ends_on: Date.new(2026, 9, 2))

      get "/api/group/calendar/events", params: { days: 30 }, headers: headers

      expect(response.parsed_body["events"].map { |e| e["title"] }).to eq(["Soon"])
    end
  end

  describe "DELETE /api/group/calendar" do
    it "removes the connection and its events" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection)

      delete "/api/group/calendar", headers: headers

      expect(response).to have_http_status(:no_content)
      expect(CalendarConnection.count).to eq(0)
      expect(CalendarEvent.count).to eq(0)
    end
  end

  describe "log redaction" do
    it "never writes the link to the log" do
      stub_request(:get, url).to_return(status: 200, body: feed)
      io = StringIO.new
      logger = ActiveSupport::Logger.new(io)
      allow(Rails).to receive(:logger).and_return(logger)
      allow_any_instance_of(ActionDispatch::Request).to receive(:logger).and_return(logger)

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(io.string).not_to include("abc123def456")
    end
  end
end
```

Add to `apps/api/spec/requests/api/group_spec.rb`, inside `describe "GET /api/group"`:

```ruby
    it "carries the calendar summary when one is connected, and null otherwise" do
      get "/api/group", headers: headers
      expect(response.parsed_body["group"]["calendar"]).to be_nil

      create(:calendar_connection, group: group, calendar_name: "Park Vista", events_count: 3, consecutive_failures: 3, last_error: "Couldn't reach the calendar.")
      get "/api/group", headers: headers

      expect(response.parsed_body["group"]["calendar"]).to include("calendar_name" => "Park Vista", "events_count" => 3, "failing" => true, "last_error" => "Couldn't reach the calendar.")
      expect(response.parsed_body["group"]["calendar"]).not_to have_key("ical_url")
    end
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && bundle exec rspec spec/requests/api/group_calendar_spec.rb spec/requests/api/group_spec.rb`
Expected: FAIL with routing errors and a missing `calendar` key.

- [ ] **Step 3: Implement routes, serializers, controller, redaction, throttle**

In `apps/api/config/routes.rb`, replace the `resource :group ...` line with:

```ruby
    resource :group, only: %i[show update], controller: "group" do
      # The house calendar link (BLO-1667). Singular, like the group: there is one per house and the
      # token names it, so no id ever appears in these paths.
      resource :calendar, only: %i[update destroy], controller: "group_calendar" do
        post :sync
        get :events
      end
    end
```

```ruby
# apps/api/app/serializers/calendar_connection_serializer.rb
# The admin's view of the house calendar link. The link itself is never here — `masked_url` is enough
# to recognise it — and `failing` is the one flag the dashboard warning hangs off.
class CalendarConnectionSerializer < ApplicationSerializer
  def as_json
    {
      calendar_name: record.calendar_name,
      masked_url: record.masked_url,
      events_count: record.events_count,
      last_synced_at: record.last_synced_at,
      last_error: record.last_error,
      failing: record.failing?
    }
  end
end
```

```ruby
# apps/api/app/serializers/calendar_event_serializer.rb
# One occurrence as both the admin preview and the member feed see it: title, civil dates, a wall-clock
# start for timed entries, the kind, and who it says is away. Description, location and attendees
# were never read, so they cannot leak here.
class CalendarEventSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      title: record.summary,
      starts_on: record.starts_on.iso8601,
      ends_on: record.ends_on.iso8601,
      all_day: record.all_day,
      start_time: record.all_day ? nil : record.starts_at.in_time_zone(record.calendar_connection.group.time_zone).strftime("%H:%M"),
      kind: record.kind,
      member_ids: record.calendar_event_members.map(&:member_id).sort
    }
  end
end
```

In `apps/api/app/serializers/group_serializer.rb`, add to the hash after `timezone_confirmed_at`:

```ruby
      calendar: CalendarConnectionSerializer.one(record.calendar_connection)
```

```ruby
# apps/api/app/controllers/api/group_calendar_controller.rb
module Api
  # The house calendar link (BLO-1667): connect, sync now, preview what was found, disconnect. Singular
  # and scoped to the token's group like GroupController; a group with no link is a 404 on sync and
  # events, never a leak about anyone else's.
  class GroupCalendarController < BaseController
    PREVIEW_DAYS_MAX = 90

    def update
      connection = CalendarConnect.call(group: current_group, url: params.require(:ical_url))
      render json: { calendar: CalendarConnectionSerializer.one(connection), events_preview: preview(connection, 30) }
    rescue CalendarConnect::Invalid => e
      render json: { error: "invalid", code: e.code, fields: { ical_url: [e.message] } }, status: :unprocessable_entity
    end

    def sync
      connection = find_connection
      connection.update!(disabled_at: nil)
      CalendarSync.new(connection).call
      render json: { calendar: CalendarConnectionSerializer.one(connection.reload) }
    end

    def events
      days = params.fetch(:days, 30).to_i.clamp(1, PREVIEW_DAYS_MAX)
      render json: { events: preview(find_connection, days) }
    end

    def destroy
      find_connection.destroy!
      head :no_content
    end

    private

    def find_connection
      current_group.calendar_connection or raise ActiveRecord::RecordNotFound
    end

    def preview(connection, days)
      today = current_group.today
      events = connection.calendar_events.overlapping(today, today + days).includes(:calendar_event_members, calendar_connection: :group).order(:starts_on, :starts_at)
      CalendarEventSerializer.many(events)
    end
  end
end
```

Check how `Api::BaseController` turns `ActiveRecord::RecordNotFound` into a 404 (it does for the admin surface: see `rescue_from` there); if it does not, add the same `rescue_from` block MemberBaseController uses.

In `apps/api/config/initializers/filter_parameter_logging.rb`, add `:ical_url` to the list:

```ruby
Rails.application.config.filter_parameters += [
  :passw, :email, :phone, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc, :ical_url
]
```

In `apps/api/config/initializers/rack_attack.rb`, add before `self.throttled_responder`:

```ruby
  # Connecting or re-syncing a calendar fetches a third-party URL on the caller's behalf; five a
  # minute per house is generous for a human and a hard stop for a loop.
  throttle("group_api/calendar_sync", limit: 5, period: 60.seconds) do |request|
    request.ip if request.post? && request.path == "/api/group/calendar/sync" || request.put? && request.path == "/api/group/calendar"
  end
```

- [ ] **Step 4: Run the specs, then the whole suite**

Run: `cd apps/api && bundle exec rspec spec/requests/api/group_calendar_spec.rb spec/requests/api/group_spec.rb && bin/ci`
Expected: PASS; `bin/ci` green (rubocop, bundler-audit, brakeman, rspec). If brakeman flags the `ical_url` fetch as SSRF, the finding is real and expected: add an inline `# brakeman:ignore` is NOT the answer; instead confirm `CalendarFetch` refuses non-HTTPS and does not expose the response body to the caller, and record the accepted risk in `config/brakeman.ignore` with that note.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/controllers/api/group_calendar_controller.rb apps/api/app/serializers apps/api/config apps/api/spec/requests/api/group_calendar_spec.rb apps/api/spec/requests/api/group_spec.rb
git commit -m "BLO-1667: admin calendar endpoints, summary serializer, redaction and throttle"
```

---

### Task 8: Web types, admin client, server actions

**Files:**
- Modify: `apps/web/src/lib/api/types.ts` (the `Group` interface and new types), `apps/web/src/lib/api/admin.ts` (after `updateGroup`), `apps/web/src/app/(admin)/dashboard/actions.ts`
- Modify: `apps/web/src/lib/dashboard.test.ts` (`group()` helper gains `calendar: null`) and any other test that builds a `Group` literal (`grep -rn "timezone_confirmed_at" apps/web/src --include=*.test.ts`)
- Test: `apps/web/src/lib/api/admin.test.ts` if it exists (add the four calls to its path assertions); otherwise `npm run typecheck` is the gate

**Interfaces:**
- Consumes: Task 7 JSON shapes.
- Produces (TypeScript): `CalendarSummary`, `CalendarEventItem`, `CalendarConnectResponse`, `CalendarEventsResponse`, `Group.calendar: CalendarSummary | null`; `connectCalendar(icalUrl)`, `syncCalendar()`, `disconnectCalendar()`, `listCalendarEvents(days)`; server actions `connectHouseCalendar(icalUrl)`, `syncHouseCalendar()`, `disconnectHouseCalendar()` each returning `{ ok: true, ... } | { ok: false; error: ApiErrorBody }`.

- [ ] **Step 1: Add the types**

In `apps/web/src/lib/api/types.ts`, add after the `Group` interface and add the `calendar` field to it:

```ts
export interface Group {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  timezone_confirmed: boolean;
  timezone_confirmed_at: string | null;
  /** The house calendar link, when an admin has connected one (BLO-1667). Never the link itself. */
  calendar: CalendarSummary | null;
}

export interface CalendarSummary {
  calendar_name: string | null;
  masked_url: string;
  events_count: number;
  last_synced_at: string | null;
  last_error: string | null;
  failing: boolean;
}

export type CalendarEventKind = "event" | "away";

export interface CalendarEventItem {
  id: number;
  title: string;
  /** Civil dates in the group's calendar, inclusive. */
  starts_on: string;
  ends_on: string;
  all_day: boolean;
  /** "HH:MM" wall-clock start in the group's zone; null for all-day entries. */
  start_time: string | null;
  kind: CalendarEventKind;
  member_ids: number[];
}

export interface CalendarConnectResponse {
  calendar: CalendarSummary;
  events_preview: CalendarEventItem[];
}

export interface CalendarSyncResponse {
  calendar: CalendarSummary;
}

export interface CalendarEventsResponse {
  events: CalendarEventItem[];
}
```

- [ ] **Step 2: Run typecheck to see what breaks**

Run: `cd apps/web && npm run typecheck`
Expected: errors only in test files that build a `Group` literal without `calendar`. Add `calendar: null,` to each (in `dashboard.test.ts` the `group()` helper). Re-run until clean.

- [ ] **Step 3: Add the client calls**

In `apps/web/src/lib/api/admin.ts`, import the four new types and add after `updateGroup`:

```ts
// --- House calendar (BLO-1667) ------------------------------------------------

/** Validate and store the pasted iCal link; Rails fetches it once and runs the first sync inline. */
export function connectCalendar(icalUrl: string): Promise<CalendarConnectResponse> {
  return adminRequest<CalendarConnectResponse>("/api/group/calendar", {
    method: "PUT",
    body: { ical_url: icalUrl },
  });
}

export function syncCalendar(): Promise<CalendarSyncResponse> {
  return adminRequest<CalendarSyncResponse>("/api/group/calendar/sync", { method: "POST" });
}

export function disconnectCalendar(): Promise<void> {
  return adminRequest<void>("/api/group/calendar", { method: "DELETE" });
}

export function listCalendarEvents(days = 30): Promise<CalendarEventsResponse> {
  return adminRequest<CalendarEventsResponse>(`/api/group/calendar/events?days=${days}`);
}
```

Check how `adminRequest` handles a 204 with no body (`disconnectCalendar`); if `requestJson` insists on JSON, add an early return for 204 there rather than in the caller.

- [ ] **Step 4: Add the server actions**

Append to `apps/web/src/app/(admin)/dashboard/actions.ts`:

```ts
import { connectCalendar, disconnectCalendar, syncCalendar } from "@/lib/api/admin";
import type { CalendarEventItem, CalendarSummary } from "@/lib/api/types";

export type CalendarActionResult<T> = ({ ok: true } & T) | { ok: false; error: ApiErrorBody };

// The house calendar link (BLO-1667). The link is a credential: it travels from the form to Rails
// through this server action and is never echoed back — the API answers with a masked form only.
export async function connectHouseCalendar(
  icalUrl: string,
): Promise<CalendarActionResult<{ calendar: CalendarSummary; events: CalendarEventItem[] }>> {
  try {
    const { calendar, events_preview } = await connectCalendar(icalUrl);
    revalidatePath("/dashboard");
    return { ok: true, calendar, events: events_preview };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

export async function syncHouseCalendar(): Promise<CalendarActionResult<{ calendar: CalendarSummary }>> {
  try {
    const { calendar } = await syncCalendar();
    revalidatePath("/dashboard");
    return { ok: true, calendar };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

export async function disconnectHouseCalendar(): Promise<CalendarActionResult<Record<never, never>>> {
  try {
    await disconnectCalendar();
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}
```

Merge the two new import lines into the existing imports at the top of the file (one import per module).

- [ ] **Step 5: Typecheck and lint, then commit**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: clean.

```bash
git add apps/web/src/lib/api/types.ts apps/web/src/lib/api/admin.ts "apps/web/src/app/(admin)/dashboard/actions.ts" apps/web/src/lib/dashboard.test.ts
git commit -m "BLO-1667: web types, admin client and actions for the house calendar"
```

---

### Task 9: House calendar settings section

**Files:**
- Create: `apps/web/src/app/(admin)/dashboard/_components/house-calendar-settings.tsx`
- Modify: `apps/web/src/app/(admin)/dashboard/_components/group-settings.tsx` (render the section under the form), `apps/web/src/app/(admin)/dashboard/page.tsx` (fetch the preview when connected and pass it down)

**Interfaces:**
- Consumes: Task 8 actions and types; `Group.calendar`.
- Produces: `<HouseCalendarSettings calendar={group.calendar} initialEvents={events} />`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/app/(admin)/dashboard/_components/house-calendar-settings.tsx
"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toastApiError } from "@/lib/api/toast";
import type { CalendarEventItem, CalendarSummary } from "@/lib/api/types";
import { formatLongDate, formatTimestamp } from "@/lib/date";

import { connectHouseCalendar, disconnectHouseCalendar, syncHouseCalendar } from "../actions";

const schema = z.object({
  ical_url: z.string().trim().url("Paste the full https link.").startsWith("https://", "Paste the full https link."),
});
type Values = z.infer<typeof schema>;

/**
 * The house calendar link (BLO-1667). Lives inside the group-settings card because the dashboard's
 * "House calendar isn't syncing" warning links here. The pasted link is sent once and never shown
 * again: the API answers with a masked form, a calendar name and a count, which is all an admin
 * needs to recognise it.
 */
export function HouseCalendarSettings({
  calendar,
  initialEvents,
}: {
  calendar: CalendarSummary | null;
  initialEvents: CalendarEventItem[];
}) {
  const [summary, setSummary] = React.useState(calendar);
  const [events, setEvents] = React.useState(initialEvents);
  const [busy, setBusy] = React.useState<"sync" | "disconnect" | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { ical_url: "" } });
  const { errors, isSubmitting } = form.formState;

  const onConnect = form.handleSubmit(async (values) => {
    const result = await connectHouseCalendar(values.ical_url);
    if (!result.ok) {
      const fieldError = result.error.fields?.ical_url?.[0];
      if (fieldError) form.setError("ical_url", { message: fieldError });
      else toastApiError(result.error, "Couldn't connect the calendar.");
      return;
    }
    setSummary(result.calendar);
    setEvents(result.events);
    form.reset({ ical_url: "" });
    toast.success(`Connected to ${result.calendar.calendar_name ?? "the calendar"}.`);
  });

  async function onSync() {
    setBusy("sync");
    const result = await syncHouseCalendar();
    setBusy(null);
    if (!result.ok) return toastApiError(result.error, "Couldn't sync the calendar.");
    setSummary(result.calendar);
    toast.success(result.calendar.last_error ? result.calendar.last_error : "Calendar synced.");
  }

  async function onDisconnect() {
    setBusy("disconnect");
    const result = await disconnectHouseCalendar();
    setBusy(null);
    if (!result.ok) return toastApiError(result.error, "Couldn't disconnect the calendar.");
    setSummary(null);
    setEvents([]);
    toast.success("Calendar disconnected.");
  }

  return (
    <section id="house-calendar" className="mt-8 scroll-mt-6 border-t pt-6">
      <h3 className="font-heading text-lg">House calendar</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Show the house&apos;s shared calendar on everyone&apos;s rota page: dinners, meetings, and who is
        away. New events appear within an hour or two.
      </p>

      {summary === null ? (
        <form onSubmit={onConnect} className="mt-4 max-w-md">
          <FieldGroup>
            <Field data-invalid={Boolean(errors.ical_url)}>
              <FieldLabel htmlFor="ical-url">Calendar link</FieldLabel>
              <Input
                id="ical-url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                aria-invalid={Boolean(errors.ical_url)}
                {...form.register("ical_url")}
              />
              <FieldDescription>
                In Google Calendar open Settings, pick the house calendar, and copy the Secret address in
                iCal format. Anyone with this link can read the calendar, so it is stored like a password.
              </FieldDescription>
              <FieldError errors={[errors.ical_url]} />
            </Field>
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full sm:w-auto">
              Connect
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            Connected to <strong>{summary.calendar_name ?? "the calendar"}</strong> · {summary.events_count}{" "}
            {summary.events_count === 1 ? "event" : "events"} in the next 90 days · last checked{" "}
            {summary.last_synced_at ? formatTimestamp(summary.last_synced_at) : "never"}
            <span className="text-muted-foreground block break-all">{summary.masked_url}</span>
          </p>
          {summary.last_error ? (
            <p role="status" className="text-destructive text-sm">
              {summary.last_error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onSync} loading={busy === "sync"}>
              Sync now
            </Button>
            <Button type="button" variant="ghost" onClick={onDisconnect} loading={busy === "disconnect"}>
              Disconnect
            </Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">What we found (next 30 days)</summary>
            {events.length === 0 ? (
              <p className="text-muted-foreground mt-2">Nothing in the next 30 days.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant={event.kind === "away" ? "warning" : "info"}>
                      {event.kind === "away" ? "Away" : "Event"}
                    </Badge>
                    <span>{event.title}</span>
                    <span className="text-muted-foreground">
                      {formatLongDate(event.starts_on)}
                      {event.ends_on !== event.starts_on ? ` to ${formatLongDate(event.ends_on)}` : ""}
                      {event.start_time ? ` · ${event.start_time}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
```

Check the `Badge` variants that exist in `apps/web/src/components/ui/badge.tsx` and use the warning-tinted (Blush or Peach) one for Away and the info (Sky) one for Event; rename the two `variant` values above to whatever the file exports. Check `formatLongDate` and `formatTimestamp` signatures in `apps/web/src/lib/date.ts` and pass what they take. Member names for away events are not shown here on purpose: the classification list is about titles, which is what the admin can change.

- [ ] **Step 2: Mount it and feed it the preview**

In `apps/web/src/app/(admin)/dashboard/page.tsx`, alongside the other fetches:

```ts
const calendarEvents = group.calendar ? (await listCalendarEvents(30)).events : [];
```

(import `listCalendarEvents` from `@/lib/api/admin`; if `group.calendar` is set but the request fails with `isApiError`, fall back to `[]` and let the settings card show the stored `last_error`). Pass it down: `<GroupSettings group={group} calendarEvents={calendarEvents} />`.

In `group-settings.tsx`, accept `calendarEvents: CalendarEventItem[]` and render, after the closing `</form>` inside `CardContent`:

```tsx
<HouseCalendarSettings calendar={group.calendar} initialEvents={calendarEvents} />
```

- [ ] **Step 3: Typecheck, lint, build, and look at it**

Run: `cd apps/web && npm run typecheck && npm run lint && npm run build`
Expected: clean. Then run the API (`cd apps/api && bin/dev`) and web (`cd apps/web && npm run dev`) against the seeded demo house, sign in as its admin, paste the real house calendar link, and confirm: the connected summary appears, "What we found" lists the coming month with Away and Event badges matching the spec's table, "Sync now" reports success, and "Disconnect" returns to the empty form. Capture phone (390px) and desktop (1440px) screenshots of the section in the not-connected, connected and failing states (set `consecutive_failures` to 3 in a console for the failing one) for the PR gallery.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/dashboard"
git commit -m "BLO-1667: house calendar section in group settings"
```

---

### Task 10: Dashboard warning when the sync is failing

**Files:**
- Modify: `apps/web/src/lib/dashboard.ts`
- Test: `apps/web/src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `Group.calendar` (Task 8).
- Produces: a `calendar-sync` warning between `timezone` and `failed-sms`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/dashboard.test.ts`:

```ts
describe("house calendar", () => {
  const failing = {
    calendar_name: "Park Vista",
    masked_url: "calendar.google.com/…f3f9a/basic.ics",
    events_count: 12,
    last_synced_at: "2026-09-13T09:27:00Z",
    last_error: "Couldn't reach the calendar.",
    failing: true,
  };

  it("warns when the sync is failing, after the timezone warning", () => {
    const warnings = collectDashboardWarnings({
      group: group({ timezone_confirmed: false, calendar: failing }),
      rotas: [],
      members: [],
      failedSms: [],
      settingsHref: SETTINGS_HREF,
    });

    expect(warnings.map((w) => w.id)).toEqual(["timezone", "calendar-sync"]);
    expect(warnings[1]).toMatchObject({
      severity: "warning",
      title: "House calendar isn't syncing",
      description:
        "Couldn't reach the calendar. Events and away dates on the members' page may be out of date.",
      href: `${SETTINGS_HREF}#house-calendar`,
      action: "Check the calendar link",
    });
  });

  it("stays quiet when connected and healthy, or not connected", () => {
    const healthy = collectDashboardWarnings({
      group: group({ calendar: { ...failing, failing: false, last_error: null } }),
      rotas: [], members: [], failedSms: [], settingsHref: SETTINGS_HREF,
    });
    const none = collectDashboardWarnings({ group: group({ calendar: null }), rotas: [], members: [], failedSms: [], settingsHref: SETTINGS_HREF });

    expect(healthy).toEqual([]);
    expect(none).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/dashboard.test.ts`
Expected: FAIL, expected ids `["timezone", "calendar-sync"]`, received `["timezone"]`.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/dashboard.ts`, after the timezone `if` block and before the failed-SMS block:

```ts
  // A calendar that stopped syncing fails quietly: the members' page just goes stale. Quieter than
  // a lost reminder, louder than a draft rota.
  if (group.calendar?.failing) {
    warnings.push({
      id: "calendar-sync",
      severity: "warning",
      title: "House calendar isn't syncing",
      description:
        `${group.calendar.last_error ?? "The last few checks failed."} ` +
        `Events and away dates on the members' page may be out of date.`,
      href: `${settingsHref}#house-calendar`,
      action: "Check the calendar link",
    });
  }
```

Check how `page.tsx` builds `settingsHref` (it already points at `#group-settings`); if it carries that fragment, strip it before appending `#house-calendar` or pass the base path. Keep the test's expectation as the contract.

- [ ] **Step 4: Run the tests and commit**

Run: `cd apps/web && npx vitest run src/lib/dashboard.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add apps/web/src/lib/dashboard.ts apps/web/src/lib/dashboard.test.ts
git commit -m "BLO-1667: dashboard warning when the house calendar stops syncing"
```

**PR 1 checkpoint.** Run `cd apps/api && bin/ci` and `cd apps/web && npm run ci`, both green. Open the PR titled `BLO-1667: house calendar sync (backend + admin settings)` with the spec link, the screenshot gallery from Task 9 Step 3, and the note that nothing syncs until an admin pastes a link. Tasks 11–13 wait for BLO-1666 and this PR to merge.

---

### Task 11: Events in the member schedule payload

**Files:**
- Modify: `apps/api/app/controllers/api/member_schedule_controller.rb` (from BLO-1666; the schedule action)
- Test: `apps/api/spec/requests/api/member/schedule_spec.rb` (from BLO-1666; add examples)

**Interfaces:**
- Consumes: `CalendarEventSerializer` (Task 7), `CalendarEvent.overlapping`.
- Produces: `GET /api/member/schedule` → `events: CalendarEventItem[]` with `ends_on >= today`, ordered by `starts_on`, then `starts_at`; `[]` when no calendar is connected.

- [ ] **Step 1: Write the failing examples**

Add to the BLO-1666 schedule request spec, inside its top-level describe (adapt the `member`/`headers` names to the file):

```ruby
  describe "events" do
    it "is empty when no calendar is connected" do
      get "/api/member/schedule", headers: member_headers(member)

      expect(response.parsed_body["events"]).to eq([])
    end

    it "lists current and upcoming events in date order, with away members" do
      connection = create(:calendar_connection, group: group)
      alfie = create(:member, group: group, name: "Alfie")
      away = create(:calendar_event, calendar_connection: connection, summary: "Alfie in Greece", kind: "away",
                                     starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1))
      CalendarEventMember.create!(calendar_event: away, member: alfie)
      create(:calendar_event, calendar_connection: connection, summary: "House dinner at home", all_day: false,
                              starts_on: Date.new(2026, 10, 1), ends_on: Date.new(2026, 10, 1),
                              starts_at: Time.utc(2026, 10, 1, 18, 0), ends_at: Time.utc(2026, 10, 1, 20, 30))
      create(:calendar_event, calendar_connection: connection, summary: "Long gone", starts_on: Date.new(2026, 9, 1), ends_on: Date.new(2026, 9, 2))
      create(:calendar_event, calendar_connection: create(:calendar_connection), summary: "Other house")

      travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { get "/api/member/schedule", headers: member_headers(member) }

      events = response.parsed_body["events"]
      expect(events.map { |e| e["title"] }).to eq(["Alfie in Greece", "House dinner at home"])
      expect(events.first).to include("kind" => "away", "member_ids" => [alfie.id], "start_time" => nil)
      expect(events.last).to include("kind" => "event", "start_time" => "19:00", "all_day" => false)
    end
  end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && bundle exec rspec spec/requests/api/member/schedule_spec.rb`
Expected: FAIL, no `events` key.

- [ ] **Step 3: Implement**

In the schedule action, after computing `today`, add:

```ruby
      connection = current_member.group.calendar_connection
      events = if connection
        connection.calendar_events.overlapping(today, today + CalendarSync::FUTURE_DAYS)
          .includes(:calendar_event_members, calendar_connection: :group)
          .order(:starts_on, :starts_at)
      else
        CalendarEvent.none
      end
```

and `events: CalendarEventSerializer.many(events)` in the rendered hash.

- [ ] **Step 4: Run, then commit**

Run: `cd apps/api && bundle exec rspec spec/requests/api/member/schedule_spec.rb`
Expected: PASS.

```bash
git add apps/api/app/controllers/api/member_schedule_controller.rb apps/api/spec/requests/api/member/schedule_spec.rb
git commit -m "BLO-1667: member schedule carries house calendar events"
```

---

### Task 12: Events and away in the feed view model

**Files:**
- Modify: `apps/web/src/lib/api/types.ts` (`MemberScheduleResponse.events: CalendarEventItem[]`)
- Create: `apps/web/src/app/(member)/s/[token]/calendar-view.ts` (pure helpers)
- Test: `apps/web/src/app/(member)/s/[token]/calendar-view.test.ts`
- Modify: `apps/web/src/app/(member)/s/[token]/schedule-view.ts` (from BLO-1666) to use the helpers; `week-section.tsx`/`shift-row.tsx` or the equivalent row components to render event rows; `people-strip.tsx` and the desktop People card for the away dot and text

**Interfaces:**
- Consumes: `CalendarEventItem`, `ScheduleMember`, BLO-1666's `buildScheduleView` and day-row types.
- Produces: `eventsStartingOn(events, date)`, `awayMemberIdsOn(events, date)`, `awayLabel(event, members)`, `eventRangeLabel(event)`; day rows gain `events: FeedEvent[]` where `FeedEvent = { id, title, kind, timeLabel: string | null, untilLabel: string | null, memberNames: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/app/(member)/s/[token]/calendar-view.test.ts
import { describe, expect, it } from "vitest";

import { awayLabel, awayMemberIdsOn, eventRangeLabel, eventsStartingOn, toFeedEvent } from "./calendar-view";
import type { CalendarEventItem, ScheduleMember } from "@/lib/api/types";

const members: ScheduleMember[] = [
  { id: 1, name: "Bass", contactable: true },
  { id: 5, name: "Alfie", contactable: true },
  { id: 6, name: "Ciara", contactable: true },
];

const greece: CalendarEventItem = { id: 77, title: "Alfie in Greece", starts_on: "2026-09-25", ends_on: "2026-10-01", all_day: true, start_time: null, kind: "away", member_ids: [5] };
const dinner: CalendarEventItem = { id: 91, title: "House dinner at home", starts_on: "2026-10-01", ends_on: "2026-10-01", all_day: false, start_time: "19:00", kind: "event", member_ids: [] };
const trip: CalendarEventItem = { id: 12, title: "Bass and Ciara France", starts_on: "2026-09-17", ends_on: "2026-09-19", all_day: true, start_time: null, kind: "away", member_ids: [1, 6] };

describe("calendar-view", () => {
  it("places an event on its first day only", () => {
    expect(eventsStartingOn([greece, dinner], "2026-09-25").map((e) => e.id)).toEqual([77]);
    expect(eventsStartingOn([greece, dinner], "2026-09-26")).toEqual([]);
    expect(eventsStartingOn([greece, dinner], "2026-10-01").map((e) => e.id)).toEqual([91]);
  });

  it("knows who is away on a date, inclusive of both ends", () => {
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-09-25")).toEqual([5]);
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-10-01")).toEqual([5]);
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-10-02")).toEqual([]);
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-09-19")).toEqual([1, 6]);
  });

  it("labels ranges and away rows", () => {
    expect(eventRangeLabel(greece)).toBe("until Thu 1 Oct");
    expect(eventRangeLabel(dinner)).toBeNull();
    expect(awayLabel(trip, members)).toBe("Bass and Ciara away");
    expect(awayLabel(greece, members)).toBe("Alfie away");
  });

  it("builds a feed event", () => {
    expect(toFeedEvent(dinner, members)).toEqual({ id: 91, title: "House dinner at home", kind: "event", timeLabel: "19:00", untilLabel: null, memberNames: [] });
    expect(toFeedEvent(greece, members)).toEqual({ id: 77, title: "Alfie in Greece", kind: "away", timeLabel: null, untilLabel: "until Thu 1 Oct", memberNames: ["Alfie"] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run "src/app/(member)/s/\[token\]/calendar-view.test.ts"`
Expected: FAIL, cannot find module `./calendar-view`.

- [ ] **Step 3: Implement the helpers**

```ts
// apps/web/src/app/(member)/s/[token]/calendar-view.ts
import type { CalendarEventItem, ScheduleMember } from "@/lib/api/types";
import { compareCivil } from "@/lib/group-dates";
import { formatShiftDate } from "@/lib/date";

export interface FeedEvent {
  id: number;
  title: string;
  kind: "event" | "away";
  /** "19:00" for timed entries, null for all-day. */
  timeLabel: string | null;
  /** "until Thu 1 Oct" for multi-day entries, null for single-day. */
  untilLabel: string | null;
  memberNames: string[];
}

/** Events that begin on this civil date; a multi-day entry appears once, on its first day. */
export function eventsStartingOn(events: CalendarEventItem[], date: string): CalendarEventItem[] {
  return events.filter((event) => event.starts_on === date);
}

/** Ids of housemates with an away entry covering this date (both ends inclusive), ascending. */
export function awayMemberIdsOn(events: CalendarEventItem[], date: string): number[] {
  const ids = new Set<number>();
  for (const event of events) {
    if (event.kind !== "away") continue;
    if (compareCivil(event.starts_on, date) > 0 || compareCivil(event.ends_on, date) < 0) continue;
    for (const id of event.member_ids) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export function eventRangeLabel(event: CalendarEventItem): string | null {
  if (event.ends_on === event.starts_on) return null;
  return `until ${formatShiftDate(event.ends_on)}`;
}

export function awayLabel(event: CalendarEventItem, members: ScheduleMember[]): string {
  const names = memberNames(event, members);
  return `${joinNames(names)} away`;
}

export function toFeedEvent(event: CalendarEventItem, members: ScheduleMember[]): FeedEvent {
  return {
    id: event.id,
    title: event.title,
    kind: event.kind,
    timeLabel: event.all_day ? null : event.start_time,
    untilLabel: eventRangeLabel(event),
    memberNames: memberNames(event, members),
  };
}

function memberNames(event: CalendarEventItem, members: ScheduleMember[]): string[] {
  return event.member_ids
    .map((id) => members.find((member) => member.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
```

`formatShiftDate` must produce "Thu 1 Oct" for the test to pass; check its output in `apps/web/src/lib/date.ts` and, if it differs (for example "Thursday 1 Oct"), use the short formatter the BLO-1666 day coins use, and update the expected strings to that exact format. The label format is not the contract; the placement and the member names are.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npx vitest run "src/app/(member)/s/\[token\]/calendar-view.test.ts"`
Expected: PASS (4 examples).

- [ ] **Step 5: Wire the helpers into the BLO-1666 view model and rows**

Read `schedule-view.ts` as merged. Where it builds each day row for a date, add `events: eventsStartingOn(schedule.events, date).map((e) => toFeedEvent(e, schedule.members))`, and add `awayToday: awayMemberIdsOn(schedule.events, schedule.today)` to the top-level view. Day rows with no shifts but with events must still render (the BLO-1666 code may skip empty days; change that predicate to "shifts or events"). Rota filter chips hide events; "Everyone" and "Just me" show them (spec section 9).

In the row component, after the shift lines of a day, render each event:

```tsx
{row.events.map((event) => (
  <div key={`event-${event.id}`} className="flex min-h-11 items-center gap-2">
    <Badge variant={event.kind === "away" ? "warning" : "info"}>{event.kind === "away" ? "Away" : "Event"}</Badge>
    <span className="truncate">{event.kind === "away" ? `${event.memberNames.join(" and ")} away · ${event.title}` : event.title}</span>
    <span className="text-muted-foreground shrink-0 text-sm">{event.timeLabel ?? event.untilLabel ?? ""}</span>
  </div>
))}
```

In `people-strip.tsx` (and the desktop People card), pass `awayToday` and render a Blush dot on the avatar with `aria-label="Away today"` when `awayToday.includes(member.id)`; the People card row appends "Away today" in the Blush text style. Use the same `Badge` variant names as Task 9.

- [ ] **Step 6: Extend the view-model tests, run everything, commit**

Add one case to the BLO-1666 `schedule-view.test.ts`: a schedule with one shift on 2026-09-20 and the `dinner` and `greece` events above yields a day row for 2026-09-25 with one event and no shifts, a 2026-10-01 row with one event, and `awayToday` equal to `[5]` when `today` is `"2026-09-27"`.

Run: `cd apps/web && npx vitest run && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add "apps/web/src/app/(member)/s/[token]" apps/web/src/lib/api/types.ts apps/web/src/components/member
git commit -m "BLO-1667: house events and away dates in the member feed"
```

---

### Task 13: Away group in the hand-off ranking

**Files:**
- Modify: `apps/web/src/app/(member)/s/[token]/cover-ranking.ts` and its test (from BLO-1666); `hand-off-sheet.tsx` (the group headings)

**Interfaces:**
- Consumes: `awayMemberIdsOn` (Task 12); BLO-1666's `rankCoverCandidates(shift, schedule)` returning `{ free, busy, unavailable }` of `Candidate`.
- Produces: `rankCoverCandidates` returns `{ free, busy, away, unavailable }`; `Candidate.reason` for away candidates reads `Away · {event title}`; away candidates are selectable.

- [ ] **Step 1: Write the failing test**

Add to the BLO-1666 `cover-ranking.test.ts`, using its existing fixtures for a shift due `2026-09-23` and a schedule with Eliza, Ciara, Raph, Mic, Alfie:

```ts
it("moves housemates who are away on the due date into an Away group, still selectable", () => {
  const schedule = withEvents(baseSchedule, [
    { id: 77, title: "Alfie in Greece", starts_on: "2026-09-20", ends_on: "2026-09-24", all_day: true, start_time: null, kind: "away", member_ids: [ALFIE] },
    { id: 78, title: "Ciara in France", starts_on: "2026-09-24", ends_on: "2026-09-26", all_day: true, start_time: null, kind: "away", member_ids: [CIARA] },
  ]);

  const groups = rankCoverCandidates(bathroomWed23, schedule);

  expect(groups.away.map((c) => c.member.id)).toEqual([ALFIE]);
  expect(groups.away[0].reason).toBe("Away · Alfie in Greece");
  expect(groups.away[0].selectable).toBe(true);
  expect([...groups.free, ...groups.busy].map((c) => c.member.id)).toContain(CIARA);
});
```

(`withEvents` is `(schedule, events) => ({ ...schedule, events })`; define it at the top of the test file if absent. `ALFIE`/`CIARA` are the ids the file's fixtures use.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run "src/app/(member)/s/\[token\]/cover-ranking.test.ts"`
Expected: FAIL, `groups.away` undefined.

- [ ] **Step 3: Implement**

In `cover-ranking.ts`, after the free/busy split and before `unavailable` is returned, add:

```ts
const awayIds = awayMemberIdsOn(schedule.events ?? [], shift.due_on);
const away: Candidate[] = [];
const keep = (list: Candidate[]) =>
  list.filter((candidate) => {
    if (!awayIds.includes(candidate.member.id)) return true;
    const event = (schedule.events ?? []).find(
      (e) => e.kind === "away" && e.member_ids.includes(candidate.member.id) &&
        compareCivil(e.starts_on, shift.due_on) <= 0 && compareCivil(e.ends_on, shift.due_on) >= 0,
    );
    away.push({ ...candidate, reason: `Away · ${event?.title ?? "away"}`, selectable: true });
    return false;
  });
const free = keep(freeCandidates);
const busy = keep(busyCandidates);
away.sort(byUpcomingThenName);
return { free, busy, away, unavailable };
```

Adapt the local names (`freeCandidates`, `busyCandidates`, `byUpcomingThenName`, `selectable`) to what the merged file uses; if `Candidate` has no `selectable` field, add it (`true` for free/busy/away, `false` for unavailable) and let the sheet read it instead of the group name.

In `hand-off-sheet.tsx`, render the groups in order `free`, `busy`, `away`, `unavailable` with headings "Free that week", "Has a shift that week", "Away", "Can't be texted". The away group's rows use the Blush badge from Task 12 beside the reason.

- [ ] **Step 4: Run everything, look at it, commit**

Run: `cd apps/web && npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: PASS. Then, with the API running against the demo house and the real calendar connected, open a member link, confirm event rows and away rows appear on the right days, the away dot shows on the people strip during a trip, and the hand-off sheet lists the away housemate under "Away" with the event title. Capture phone and desktop screenshots of the feed and the sheet for the PR gallery.

```bash
git add "apps/web/src/app/(member)/s/[token]"
git commit -m "BLO-1667: hand-off ranking deprioritises housemates who are away"
```

**PR 2 checkpoint.** `bin/ci` and `npm run ci` green. PR titled `BLO-1667: house calendar events on the member dashboard`, with the spec link, before/after screenshots (before = the BLO-1666 feed without events) and the gallery link.

---

## Self-review

- Spec coverage: connection flow (Tasks 5, 7, 9), storage and secret handling (1, 7), sync mechanics and job (2, 3, 5, 6), away inference and admin visibility (4, 9), failures on the dashboard (10), member payload and feed hooks (11, 12, 13), gems and fixtures (3), throttle and redaction (7), rollout as two PRs (checkpoints). Admin week glance: intentionally no task (spec section 10).
- Names used across tasks: `CalendarFetch.call`/`Result`; `CalendarParser.new(body, zone:, from:, to:)`, `Occurrence`; `AwayClassifier.new(members).classify(summary:, all_day:, starts_on:, ends_on:)`; `CalendarSync.new(connection).call`, `CalendarSync.window_for(group)`, `CalendarSync::MESSAGES`, `FUTURE_DAYS`; `CalendarConnect.call(group:, url:)`, `CalendarConnect::Invalid#code`; `CalendarConnectionSerializer`, `CalendarEventSerializer`; web `CalendarSummary`, `CalendarEventItem`, `connectCalendar`/`syncCalendar`/`disconnectCalendar`/`listCalendarEvents`, `connectHouseCalendar`/`syncHouseCalendar`/`disconnectHouseCalendar`, `HouseCalendarSettings`, `eventsStartingOn`/`awayMemberIdsOn`/`awayLabel`/`eventRangeLabel`/`toFeedEvent`, `rankCoverCandidates` with `away`.
- Known adaptation points (not placeholders): the recurrence gem's exact value types (Task 3 Step 1 probe settles them), the Badge variant names and date formatter output (Tasks 9, 12), and the BLO-1666 file internals (Tasks 11–13), each with the exact contract the tests pin.

## Execution

Plan complete. Recommended execution: subagent-driven, one Opus subagent per task, with groups B (Tasks 2–4) running in parallel with A (Task 1), then C (5–7), then D (8–10) for PR 1; group E (11–13) only after BLO-1666 and PR 1 have merged and the branch is rebased.
