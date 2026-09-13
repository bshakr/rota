# House calendar sync (BLO-1667) — design

- Ticket: https://linear.app/bloombase/issue/BLO-1667/house-calendar-sync-google-calendar-ical-feed-events-and-away-dates-on
- Builds on: `2026-09-13-member-dashboard-feed-design.md` (BLO-1666), whose section 9 reserves the hooks this spec fills.
- Wireframes (Option A shows events and away rows): https://claude.ai/code/artifact/894ed824-28c2-4288-bdba-aa4a9d19fdd5

## 1. Problem

The house already keeps a shared Google Calendar: who is away, house dinners, meetings, birthdays. None of it reaches Rota Monster, so a member handing off a shift cannot see that a housemate is in France that week, and the member page shows chores in a vacuum. The admin should be able to connect that calendar once, and from then on the member feed shows upcoming house events and treats away housemates accordingly.

## 2. Goals and non-goals

Goals
- An admin connects the house calendar by pasting one link, with immediate feedback that it worked.
- The app keeps a fresh copy of the next three months of events with no further admin effort.
- Away dates are inferred from event titles the way the house already writes them, and the admin can see what was inferred.
- Members see upcoming events in the feed and the hand-off ranking knows who is away.
- Failures are visible on the admin dashboard, never silent.

Non-goals
- Two-way sync, or writing rota shifts into Google Calendar.
- Google sign-in, the Calendar API, or a Google Cloud project.
- Per-event manual overrides of the away classification (see open question 3).
- Event descriptions, locations, attendees, or attachments: not fetched into the app.

## 3. Approach in one paragraph

Google Calendar exposes a per-calendar "Secret address in iCal format" (Settings → Integrate calendar). It is a plain HTTPS URL that returns the whole calendar as an `.ics` file with no login. The admin pastes it into group settings; the API fetches and parses it once to confirm it works, stores it, and an hourly Solid Queue job re-fetches it, expands recurring events over a rolling window, and upserts the result into a `calendar_events` table. Members read those rows through the schedule endpoint from BLO-1666. Google caches these feeds, so events appear within one to two hours of being added; that is acceptable for house events and is stated in the settings UI. The Calendar API path was rejected: it needs a Google Cloud project, a service account key on the server, and the calendar shared with a robot account, for a freshness gain nobody asked for.

## 4. Admin connection flow

Where: a new "House calendar" section in the existing group-settings card on the admin dashboard (`apps/web/src/app/(admin)/dashboard/_components/group-settings.tsx`, anchor `#group-settings`).

States
1. Not connected: one field "Calendar link" with help text: "In Google Calendar open Settings, pick the house calendar, and copy the Secret address in iCal format. Anyone with this link can read the calendar, so it is stored like a password." Button "Connect".
2. Connecting (on submit): the API fetches and parses the calendar in the same request (timeouts below), runs the first sync inline, and returns a summary. Typical time: under three seconds.
3. Connected: "Connected to {calendar name} · {n} events in the next 90 days · last checked {relative time}". The link is shown masked (host plus the last four characters of the secret). Buttons: "Sync now" and "Disconnect". A small "What we found" disclosure lists the next 30 days of events with an Away or Event badge and the housemates each away event was matched to, so a misclassified title can be spotted and renamed in Google Calendar.
4. Failing: the same card shows the last error in plain words ("Google says this link no longer works. Paste a new secret address." or "Couldn't reach the calendar for the last 6 hours."). The dashboard warning list gains an entry (section 8).

Validation on connect (HTTP 422 with a field error, no connection stored):
- Not `https://`, or not a URL at all: "Paste the full https link."
- Fetch fails, times out, or exceeds the size cap: "Couldn't fetch that link. Check it is the secret iCal address and try again."
- Body does not parse as a calendar (`BEGIN:VCALENDAR` missing): "That link isn't a calendar feed."

Disconnect deletes the connection and every stored event. Re-connecting is a fresh start.

API (admin, JWT-authenticated, inherits `Api::BaseController` and its tenancy scoping):
- `GET /api/group` gains `calendar: null | { calendar_name, masked_url, events_count, last_synced_at, last_error, failing: boolean }` in `GroupSerializer`.
- `PUT /api/group/calendar` body `{ ical_url }`: validate, fetch, parse, upsert connection, first sync, respond with the `calendar` summary plus `events_preview` (next 30 days) for the disclosure.
- `POST /api/group/calendar/sync`: run a sync now, respond with the summary. Throttled by rack-attack to 5 per minute per group.
- `DELETE /api/group/calendar`: disconnect.
- `GET /api/group/calendar/events?days=30`: the preview list, for the disclosure after page load.
Routes: `resource :calendar, only: %i[update destroy], controller: "group_calendar"` nested under `resource :group`, plus `post "group/calendar/sync"` and `get "group/calendar/events"`.

## 5. What is stored

Two tables, not columns on `groups`. Sync bookkeeping is five or six columns that would clutter the tenant row, a separate table keeps the secret in one narrow place, and it leaves room for a second calendar later without a migration.

`calendar_connections`
- `group_id` (FK, unique: one calendar per house for now), `ical_url` (string, not null), `calendar_name` (from `X-WR-CALNAME`, nullable), `etag`, `last_modified` (strings, for conditional GET), `last_fetched_at`, `last_synced_at`, `last_error` (string, nullable), `consecutive_failures` (integer, default 0), `disabled_at` (datetime, nullable), `events_count` (integer, default 0), timestamps.
- `has_many :calendar_events, dependent: :delete_all`. `Group has_one :calendar_connection, dependent: :destroy`.

`calendar_events`
- `calendar_connection_id` (FK), `uid` (string), `instance_key` (string; `"#{uid}##{occurrence start in ISO 8601}"`, unique per connection), `summary` (string, the title, truncated to 200 characters), `starts_on` and `ends_on` (dates, inclusive, in the group's calendar), `starts_at` and `ends_at` (datetimes, null for all-day events), `all_day` (boolean), `kind` (string: `event` or `away`), `synced_at` (datetime), timestamps.
- Indexes: unique on `[calendar_connection_id, instance_key]`; `[calendar_connection_id, starts_on]`.

`calendar_event_members` (join table for away matches): `calendar_event_id`, `member_id`, unique pair; both FKs cascade. A join table rather than an integer array so that removing a member cleans up and the query "who is away on this date" is a plain join.

The secret URL. The app has no Active Record encryption configured and stores member access tokens in plaintext, and a leaked iCal URL is the same class of risk as a leaked member token (read access to house data). The URL is therefore stored in plaintext, but handled as a credential everywhere else: `ical_url` is added to `config.filter_parameters` so request logs redact it; the API never returns it, only `masked_url`; error messages and log lines carry the exception class and the HTTP status, never the URL; the admin UI never pre-fills the field with the stored value. Open question 1 covers turning encryption on.

## 6. Sync mechanics

`SyncHouseCalendarsJob` (Solid Queue, `config/recurring.yml`, every hour at minute 27, clear of the reminder sweep on the hour and the cleanup at minute 12) iterates `CalendarConnection.enabled.find_each` and calls `CalendarSync.new(connection).call` with the same per-record rescue, log, and `Rails.error.report` idiom as `TopUpShiftWindowsJob`. The same service runs inline for connect and "Sync now".

`CalendarFetch` (Net::HTTP, the idiom already used for the WorkOS JWKS fetch)
- HTTPS only. Open timeout 5s, read timeout 15s. Follows at most two redirects, HTTPS only.
- Sends `If-None-Match` and `If-Modified-Since` from the stored `etag` and `last_modified`; a 304 updates `last_fetched_at` and ends the run with no parsing.
- Streams the body and aborts past 5 MB (a house calendar is tens of kilobytes; the cap is a guard against a wrong URL).
- Returns the body plus the two caching headers. Raises `CalendarFetch::Unreachable` (network, timeout, 5xx), `CalendarFetch::Gone` (401, 403, 404, which is what Google returns once the owner resets the secret address), `CalendarFetch::TooLarge`.

`CalendarParser`
- Gems: `icalendar` (~> 2.12) to parse; `icalendar-recurrence` (~> 1.2) for `occurrences_between`, which expands `RRULE` and honours `EXDATE`. `ice_cube` comes with it.
- Window: `group.today - 7.days` to `group.today + 90.days`, matching the shift horizon. An event is kept when its `[starts_on, ends_on]` overlaps the window.
- All-day events (`DTSTART;VALUE=DATE`): `starts_on = DTSTART`, `ends_on = DTEND - 1 day` (iCal's DTEND is exclusive; a missing DTEND means one day). `all_day = true`, `starts_at`/`ends_at` null.
- Timed events: convert to the group's time zone, `starts_on`/`ends_on` are the local dates, `ends_on` drops back a day when the end lands exactly on local midnight. Floating times (no TZID, no Z) use `X-WR-TIMEZONE` if present, else the group's zone.
- Recurrence overrides: a VEVENT with `RECURRENCE-ID` replaces the generated occurrence with the same UID and start; `STATUS:CANCELLED` drops it. Instances of a recurring multi-day event that started before the window and run into it are not expanded by the library; documented limitation, negligible for a house calendar.
- `X-WR-CALNAME` becomes `calendar_name`. Only `SUMMARY`, `UID`, `DTSTART`, `DTEND`, `RRULE`, `EXDATE`, `RECURRENCE-ID`, `STATUS` are read. Nothing else is stored.

`CalendarSync`
1. Fetch. On 304, done.
2. Parse into occurrence structs. A body that is not a calendar raises `CalendarParser::NotACalendar`.
3. Classify each occurrence (section 7) against the group's active members.
4. In one transaction: `upsert_all` the rows keyed on `instance_key` with `synced_at = now`; replace the join rows for away events; delete this connection's events with `synced_at < now` (instances no longer in the feed, cancelled, or now outside the window). Update `events_count`, `last_synced_at`, `etag`, `last_modified`, reset `consecutive_failures` and `last_error`.
5. On any failure: increment `consecutive_failures`, set `last_error` to a short human sentence keyed on the exception class, keep the existing rows (stale beats empty). `Gone` sets `disabled_at` after three consecutive failures (the link was reset; retrying hourly forever is pointless). Any failure sets `disabled_at` after 48 consecutive failures (two days). A disabled connection is skipped by the job until the admin presses "Sync now" or saves a new link, both of which clear `disabled_at`.

## 7. Away inference

The house already writes away dates as calendar titles; the rule formalises that habit rather than asking for a new one.

Normalise the title: lowercase, strip anything in brackets or parentheses, strip emoji and punctuation except `-`, `–`, `&`, `+`, `,`, `'`, collapse whitespace.

An occurrence is `away` when all three hold:
1. The title begins with one or more housemate names: the first word of each active member's name, or the full name, in any of the forms `Alfie`, `Bass and Eliza`, `Bass & Eliza`, `Bass, Eliza`. Matching is on whole words. A name followed by `'s` is possessive and never matches (so "Alfie's birthday" is an event, not Alfie away). If two housemates share a first name, only the full name matches.
2. The occurrence is all-day, or spans at least one midnight in the group's zone. A timed slot on one day ("Raphael – Tummo retreat w Nico, 17:30–18:30") is an event, not an absence.
3. The remainder of the title contains none of the exclusion words: `bin`, `bins`, `birthday`, `bday`, `b-day`, `dinner`, `party`, `meeting`, `clean`, `cleaning`, `rota`, `shift`, `pay`, `rent`.
Additionally, a title that begins with the word `away` followed by housemate names is always `away` (an explicit marker for anyone who wants one).

The matched members are attached through `calendar_event_members`. Everything else is `event`.

Worked examples from the house's own calendar (housemates Bass, Eliza, Raph, Ciara, Alfie, Mic):

| Title | Result |
|---|---|
| Alfie away in Carlisle (Filming), 16–19 Sep all-day | away: Alfie |
| Ciara – France, 17–19 Sep all-day | away: Ciara |
| Bass and Eliza France, multi-day | away: Bass, Eliza |
| Mic Ireland with fam, multi-day | away: Mic |
| Alfie in Greece (Song Leader Retreat), 25 Sep–1 Oct | away: Alfie |
| Raph Bins Out, all-day | event (exclusion word "bins") |
| Alfie Bday, all-day | event (exclusion word "bday") |
| Naomi's birthday | event (not a housemate, and possessive) |
| Ester in London [ES4C], multi-day | event (Ester is not a housemate) |
| House dinner @ home, 19:00 | event |
| Raphael – Tummo retreat w Nico, 17:30–18:30 | event (timed, single day); note "Raphael" also fails to match "Raph" as a whole word |

The admin sees the outcome in the "What we found" disclosure (section 4). Classification is recomputed on every sync, so renaming a title in Google Calendar, or renaming a member in the app, corrects it within the hour.

## 8. Surfacing failures

`collectDashboardWarnings` (`apps/web/src/lib/dashboard.ts`) gains one entry, `calendar-sync`, severity `warning`, when `group.calendar` is present and `failing` is true (`consecutive_failures >= 3` or `disabled_at` set): title "House calendar isn't syncing", description built from `last_error`, action "Check the calendar link" pointing at `#group-settings`. It sits after the timezone warning and before failed texts: quieter than a lost reminder, louder than a draft rota. Unit-tested alongside the existing cases.

## 9. Member payload and feed integration

`GET /api/member/schedule` (BLO-1666) gains:

```
"events": [
  { "id": 91, "title": "House dinner at home", "starts_on": "2026-10-01", "ends_on": "2026-10-01",
    "all_day": false, "start_time": "19:00", "kind": "event", "member_ids": [] },
  { "id": 77, "title": "Alfie in Greece", "starts_on": "2026-09-25", "ends_on": "2026-10-01",
    "all_day": true, "start_time": null, "kind": "away", "member_ids": [5] }
]
```
Events with `ends_on >= today`, ordered by `starts_on` then `start_time`, from the group's connection; an empty array when there is no connection. `start_time` is the local wall-clock time in the group's zone. Titles are returned as stored (the original summary, not the normalised form).

Exactly the hooks BLO-1666 section 9 reserved:
- `schedule-view.ts`: interleave events into day rows on their `starts_on`; multi-day rows read "until {weekday}" and away rows read "{names} away · {range}"; a person is "away today" when an away event overlaps `today`, which the people strip shows as a dot and the People card as text.
- `cover-ranking.ts`: a candidate with an away event overlapping the shift's `due_on` moves to a fourth group, "Away", placed after "Has a shift that week" and before "Can't be texted". Away candidates stay selectable, deprioritised and labelled with the reason, because the human may know the trip ended early (open question 4).
- Filter chips are unchanged; events are shown under "Everyone" and "Just me" alike and hidden when a rota chip is active.

## 10. Admin dashboard

Not in this ticket. The week glance stays chores-only; the admin's calendar view is Google Calendar itself. The settings disclosure is enough to verify the sync. Revisit when an admin asks for "who is away this week" next to the rota.

## 11. Gems and libraries

- `icalendar` ~> 2.12 (parsing), `icalendar-recurrence` ~> 1.2 (expansion; brings `ice_cube`). Both pass bundler-audit today; the recurrence gem is lightly maintained, so the parser wraps it behind `CalendarParser` and the fixture suite is what protects against a future swap.
- Net::HTTP, as the JWKS fetch already does. No Faraday: it is only present transitively through `twilio-ruby`.
- WebMock (already in the test group) stubs the fetch in specs.

## 12. Testing

- Fixtures in `spec/fixtures/ics/`: simple timed event; all-day single day; all-day multi-day (exclusive DTEND); weekly RRULE with EXDATE; RRULE with a RECURRENCE-ID override and a cancelled instance; floating time with `X-WR-TIMEZONE`; a Google export with `X-WR-CALNAME`; a non-calendar HTML body.
- `CalendarParser` specs per fixture, asserting dates in a non-UTC group zone (Europe/London across the October clock change, and one Auckland case).
- `AwayClassifier` specs for every row of the table in section 7 plus shared-first-name and possessive cases.
- `CalendarSync` specs with WebMock: first sync, 304 no-op, changed feed (added, removed, retitled instance), `Gone` after reset, size cap, failure counting and disabling, member rename reclassification.
- Request specs: connect happy path and each 422 message; masked URL and absent raw URL in every response; tenancy (one group cannot read or sync another's); throttle on sync; disconnect deletes events; schedule payload `events` shape and window.
- Log redaction spec: a request carrying `ical_url` never writes the secret to the log (mirrors `token_privacy_spec`).
- Web (Vitest): `collectDashboardWarnings` calendar case; `schedule-view` interleaving and away-today; `cover-ranking` Away group.
- Manual: connect the real house calendar in development, read the "What we found" list against Google Calendar, then hand off a shift during a known trip.

## 13. Privacy

The calendar is already shared with the whole house, so showing its titles and dates to members widens nothing. The app stores only summary, dates, and the recurrence key; descriptions, locations, and attendees are not read. Members receive title, dates, kind, and matched member ids. Admins see the masked link and the classification. Disconnect removes every stored event.

## 14. Rollout

- Depends on BLO-1666 merging first (the schedule endpoint and the feed hooks).
- Two PRs, both dark by default because nothing syncs until an admin pastes a link: PR 1 backend plus admin settings (migrations, models, fetch, parser, classifier, sync, job, endpoints, settings UI, dashboard warning); PR 2 member payload and feed integration. No feature flag exists in the app and none is added.
- Migrations are additive. The recurring job entry ships with PR 1 and is a no-op until a connection exists.
- Before merge of PR 1: connect the real calendar against a local API pointed at the seeded demo house and confirm the classification table.

## 15. Open questions for Bass (with the default this spec assumes)

1. Encrypt the stored link? Default: no, plaintext with masking and log redaction, consistent with member tokens. Turning on Active Record encryption is a separate hardening ticket that adds three Railway env vars and would cover member tokens too.
2. Away rule: name prefix plus all-day or overnight plus exclusion words (default), or a separate "Away" calendar whose every event counts as away? The default fits how the house already writes titles; a second calendar is the fallback if the rule proves noisy.
3. Per-event override in the app when the rule gets a title wrong? Default: no; rename the event in Google Calendar, which the hourly sync picks up.
4. Away housemates in the hand-off sheet: deprioritised but selectable (default), or hidden?
5. Sync cadence: hourly (default). Google caches the feed for one to two hours, so more often buys nothing.
6. Show timed events with their start time in the member feed: yes (default), in the group's zone.
