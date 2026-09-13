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
- Away dates are inferred from event titles the way the house already writes them, by a small Claude model rather than a formula, and the admin can see what was inferred and why.
- Members see upcoming events in the feed and the hand-off ranking knows who is away.
- Failures are visible on the admin dashboard, never silent.

Non-goals
- Two-way sync, or writing rota shifts into Google Calendar.
- Google sign-in, the Calendar API, or a Google Cloud project.
- Per-event manual overrides of the away classification (see open question 3).
- Event descriptions, locations, attendees, or attachments: not fetched into the app.

## 3. Approach in one paragraph

Google Calendar exposes a per-calendar "Secret address in iCal format" (Settings → Integrate calendar). It is a plain HTTPS URL that returns the whole calendar as an `.ics` file with no login. The admin pastes it into group settings; the API fetches and parses it once to confirm it works, stores it, and an hourly Solid Queue job re-fetches it, expands recurring events over a rolling window, asks Claude Haiku 4.5 which titles mean a housemate is away, and upserts the result into a `calendar_events` table. Members read those rows through the schedule endpoint from BLO-1666. Google caches these feeds, so events appear within one to two hours of being added; that is acceptable for house events and is stated in the settings UI. The Calendar API path was rejected: it needs a Google Cloud project, a service account key on the server, and the calendar shared with a robot account, for a freshness gain nobody asked for.

## 4. Admin connection flow

Where: a new "House calendar" section in the existing group-settings card on the admin dashboard (`apps/web/src/app/(admin)/dashboard/_components/group-settings.tsx`, anchor `#group-settings`).

States
1. Not connected: one field "Calendar link" with help text: "In Google Calendar open Settings, pick the house calendar, and copy the Secret address in iCal format. Anyone with this link can read the calendar, so it is stored like a password. Event titles are sent to Anthropic's Claude to tell trips from other events." Button "Connect".
2. Connecting (on submit): the API fetches and parses the calendar in the same request (timeouts below), runs the first sync inline (including the first Claude classification, section 7), and returns a summary. Typical time: five to fifteen seconds for a busy calendar, so the button reads "Connecting" until it returns (open question 7 covers doing this in the background instead).
3. Connected: "Connected to {calendar name} · {n} events in the next 90 days · last checked {relative time}". The link is shown masked (host plus the last four characters of the secret). Buttons: "Sync now" and "Disconnect". A small "What we found" disclosure lists the next 30 days of events with an Away or Event badge, the housemates each away event was matched to, and the model's one-line reason as muted text, so a misclassified title can be spotted and renamed in Google Calendar. While any events are still pending a verdict (section 7.4) the card adds "{n} events not sorted yet. We'll try again within the hour."
4. Failing: the same card shows the last error in plain words ("Google says this link no longer works. Paste a new secret address." or "Couldn't reach the calendar for the last 6 hours."). The dashboard warning list gains an entry (section 8).

Validation on connect (HTTP 422 with a field error, no connection stored):
- Not `https://`, or not a URL at all: "Paste the full https link."
- Fetch fails, times out, or exceeds the size cap: "Couldn't fetch that link. Check it is the secret iCal address and try again."
- Body does not parse as a calendar (`BEGIN:VCALENDAR` missing): "That link isn't a calendar feed."

Disconnect deletes the connection and every stored event. Re-connecting is a fresh start.

API (admin, JWT-authenticated, inherits `Api::BaseController` and its tenancy scoping):
- `GET /api/group` gains `calendar: null | { calendar_name, masked_url, events_count, unclassified_count, last_synced_at, last_error, failing: boolean }` in `GroupSerializer`.
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
- `calendar_connection_id` (FK), `uid` (string), `instance_key` (string; `"#{uid}##{occurrence start in ISO 8601}"`, unique per connection), `summary` (string, the title, truncated to 200 characters), `starts_on` and `ends_on` (dates, inclusive, in the group's calendar), `starts_at` and `ends_at` (datetimes, null for all-day events), `all_day` (boolean), `kind` (string: `event` or `away`), `fingerprint` (string, section 7.3), `reason` (string, nullable, the model's one-line explanation), `classified_at` (datetime, null while a verdict is pending), `synced_at` (datetime), timestamps.
- Indexes: unique on `[calendar_connection_id, instance_key]`; `[calendar_connection_id, starts_on]`; `[calendar_connection_id, fingerprint]`.

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
3. Fingerprint each occurrence, reuse stored verdicts, and send the rest to Claude in one batched call (section 7). A failed call leaves those occurrences pending; it never fails the sync.
4. In one transaction: `upsert_all` the rows keyed on `instance_key` with `synced_at = now`; replace the join rows for away events; delete this connection's events with `synced_at < now` (instances no longer in the feed, cancelled, or now outside the window). Update `events_count`, `last_synced_at`, `etag`, `last_modified`, reset `consecutive_failures` and `last_error`.
5. On any failure: increment `consecutive_failures`, set `last_error` to a short human sentence keyed on the exception class, keep the existing rows (stale beats empty). `Gone` sets `disabled_at` after three consecutive failures (the link was reset; retrying hourly forever is pointless). Any failure sets `disabled_at` after 48 consecutive failures (two days). A disabled connection is skipped by the job until the admin presses "Sync now" or saves a new link, both of which clear `disabled_at`.

## 7. Away inference

The house already writes away dates as calendar titles ("Alfie away in Carlisle", "Ciara – France", "Bass and Eliza France"). Rather than encode that habit as a formula (name prefix, exclusion words, whole-word matching), each title is read by a small Claude model that is told who lives in the house and what "away" means, and returns a verdict. Decided by Bass on 2026-09-13, replacing the rule-based classifier: a formula is brittle against the next title nobody anticipated ("Raph off to Lisbon", "Ciara home for the weekend", "Alfie back Thursday"), and the model handles those without a code change.

### 7.1 Model and call shape

- Model: Claude Haiku 4.5, `claude-haiku-4-5`, through the official `anthropic` Ruby gem. No extended thinking; this is a short classification. Sonnet 5 (`claude-sonnet-5`) is the step up if Haiku proves unreliable on real titles (open question 2).
- One request per sync for everything that needs a verdict, chunked at 50 events per request. `max_tokens` 4096 per chunk.
- Structured output (`output_config.format` with a JSON schema, which Haiku 4.5 supports) so the reply is always valid JSON in a fixed shape; no free-text parsing.
- System prompt (stable across calls, so it stays byte-identical): the app's purpose, the definition of away, the guidance below, and the roster of active housemates as `id: name` pairs.
- User message: a JSON array of the events to classify, each `{ ref, title, all_day, starts_on, ends_on, nights }` where `ref` is the fingerprint (7.3) and `nights` is `ends_on - starts_on`.
- Reply schema: `{ verdicts: [{ ref, kind: "event" | "away", member_ids: [integer], reason: string }] }`. `reason` is one short clause the admin sees ("Alfie, three nights in Carlisle"; "a birthday, not a trip"), capped at 120 characters on our side.
- Client: `timeout` 20 seconds, SDK default retries (2) on 429 and 5xx. `ANTHROPIC_API_KEY` from the environment, required in production (the API refuses to boot without it, the same way it refuses to boot without Twilio credentials), optional in development and test.

Guidance given to the model, in plain words rather than a rule list. An event is `away` when a housemate is not sleeping at the house for at least one night: the title names one or more housemates (by first name or full name; a possessive like "Alfie's" is about them, not by them), and the event is all-day or spans a night. Everything else is `event`: chores and bins, birthdays and parties, dinners and meetings, a timed slot on one day even if it names a housemate, and anything about people who are not on the roster. When unsure, prefer `event`; a missed trip costs less than a housemate wrongly shown as away. Only return member ids from the roster.

### 7.2 Validation of the reply

The reply is data, not trusted output. Each verdict is accepted only when its `ref` is one we sent, `kind` is one of the two values, and every `member_ids` entry is on the roster. An `away` verdict with no members becomes `event`. A ref with no valid verdict is left pending (7.4). Nothing in the reply is executed or interpolated anywhere except the `reason` string, which is stored truncated and rendered as text.

### 7.3 Verdicts are cached per fingerprint

A verdict depends only on the title, whether the event is all-day, whether it spans a night, and who is on the roster. So each occurrence gets a `fingerprint`: SHA-256 of the normalised title (lowercased, whitespace collapsed), `all_day`, `nights > 0`, and the sorted active roster (`id:name`). Before calling Claude, the sync looks for an existing event row of this connection with the same fingerprint and a verdict, and reuses it, members included. Only fingerprints with no stored verdict go to the model, de-duplicated.

What this buys:
- Recurring events (weekly bins, monthly house meeting) are classified once, not once per instance.
- An hourly sync with nothing new makes no API call at all (and a 304 from Google skips even the parse).
- The same title always gets the same verdict, so a member's feed never flips between "away" and "event" from one sync to the next because a sampled reply differed.
- Renaming an event in Google Calendar, or renaming a member in the app, changes the fingerprint and triggers a fresh verdict within the hour. That is still how a wrong verdict is corrected (open question 3 is unchanged: no per-event override in the app).

`calendar_events` therefore carries `fingerprint` (string, indexed with the connection), `reason` (string, nullable), and `classified_at` (datetime, null while pending).

### 7.4 When the model call fails

A failed or partial Claude call never fails the sync. The events are stored anyway with `kind: "event"`, empty members, and `classified_at: null`; the failure is logged with the exception class and status (never the titles) and reported through `Rails.error.report`. The next sync retries every pending fingerprint. The admin settings card shows "{n} events not sorted yet. We'll try again within the hour." while any are pending, and the serializer exposes `unclassified_count` for it. A missing key outside production behaves the same way, with one log line at boot.

### 7.5 Worked examples

The same titles as before, from the house's own calendar (housemates Bass, Eliza, Raph, Ciara, Alfie, Mic). These are the expected verdicts and double as the eval set (section 12); they are not unit-test assertions against the live model.

| Title | Expected |
|---|---|
| Alfie away in Carlisle (Filming), 16–19 Sep all-day | away: Alfie |
| Ciara – France, 17–19 Sep all-day | away: Ciara |
| Bass and Eliza France, multi-day | away: Bass, Eliza |
| Mic Ireland with fam, multi-day | away: Mic |
| Alfie in Greece (Song Leader Retreat), 25 Sep–1 Oct | away: Alfie |
| Raph off to Lisbon, multi-day | away: Raph (no formula would have caught "off to") |
| Raph Bins Out, all-day | event (a chore) |
| Alfie Bday, all-day | event (a birthday) |
| Naomi's birthday | event (not a housemate) |
| Ester in London [ES4C], multi-day | event (Ester is not a housemate) |
| House dinner @ home, 19:00 | event |
| Raphael – Tummo retreat w Nico, 17:30–18:30 | event (timed, single day) |

The admin sees the verdict and the reason in the "What we found" disclosure (section 4).

### 7.6 Cost

Haiku 4.5 is $1 per million input tokens and $5 per million output tokens. A busy house calendar is roughly:

| Moment | Calls | Approx. tokens | Approx. cost |
|---|---|---|---|
| First connect, 60 occurrences, 35 unique titles | 1 | 2.5k in, 1.5k out | $0.01 |
| Hourly sync, nothing new | 0 | 0 | $0 |
| Hourly sync, one new title | 1 | 0.7k in, 0.05k out | $0.001 |

Under a cent per house per month in steady state. The prompt is well under the minimum cacheable prefix for Haiku, so prompt caching is not used.

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
- `anthropic` (the official Ruby SDK) for the classifier: `client.messages.create` with `output_config.format` for structured output. It is the only place the app talks to Anthropic; the client is built once in an initializer from `ANTHROPIC_API_KEY`.
- Net::HTTP for the calendar fetch, as the JWKS fetch already does. No Faraday: it is only present transitively through `twilio-ruby`.
- WebMock (already in the test group) stubs both the calendar fetch and `https://api.anthropic.com/v1/messages` in specs. No spec ever reaches the live model.

## 12. Testing

- Fixtures in `spec/fixtures/ics/`: simple timed event; all-day single day; all-day multi-day (exclusive DTEND); weekly RRULE with EXDATE; RRULE with a RECURRENCE-ID override and a cancelled instance; floating time with `X-WR-TIMEZONE`; a Google export with `X-WR-CALNAME`; a non-calendar HTML body.
- `CalendarParser` specs per fixture, asserting dates in a non-UTC group zone (Europe/London across the October clock change, and one Auckland case).
- `CalendarClassifier` specs with WebMock: the request carries the model id, the JSON schema, the roster, and the titles (and nothing else from the feed); a valid reply becomes verdicts; a reply with an unknown ref, an off-roster member id, or an away verdict with no members is dropped or coerced (section 7.2); a 429, a 5xx, a timeout, and a missing key each raise `CalendarClassifier::Failed` without leaking titles into the message; chunking at 50.
- Classifier eval, not a spec: `bin/classifier-eval` runs the section 7.5 table against the live model with the demo roster and prints a per-row pass or fail. Run by hand before PR 1 merges and whenever the prompt or model changes; expected 12 of 12. Not part of `bin/ci`.
- `CalendarSync` specs with WebMock: first sync, 304 no-op, changed feed (added, removed, retitled instance), `Gone` after reset, size cap, failure counting and disabling; verdict reuse by fingerprint (a second sync with the same titles makes no Claude call); member rename changes fingerprints and triggers a fresh call; a failed Claude call stores the events pending and the sync still succeeds; the next sync retries only the pending fingerprints.
- Request specs: connect happy path and each 422 message; masked URL and absent raw URL in every response; tenancy (one group cannot read or sync another's); throttle on sync; disconnect deletes events; schedule payload `events` shape and window.
- Log redaction spec: a request carrying `ical_url` never writes the secret to the log (mirrors `token_privacy_spec`).
- Web (Vitest): `collectDashboardWarnings` calendar case; `schedule-view` interleaving and away-today; `cover-ranking` Away group.
- Manual: connect the real house calendar in development, read the "What we found" list and reasons against Google Calendar, then hand off a shift during a known trip.

## 13. Privacy

The calendar is already shared with the whole house, so showing its titles and dates to members widens nothing. The app stores only summary, dates, and the recurrence key; descriptions, locations, and attendees are not read. To classify, the event titles, their dates, and the housemates' names as entered in the app are sent to Anthropic's API and handled under Anthropic's commercial API data policy (not used to train models); the settings help text says so. Nothing else about the house leaves the server. Members receive title, dates, kind, and matched member ids. Admins see the masked link and the classification. Disconnect removes every stored event.

## 14. Rollout

- Depends on BLO-1666 merging first (the schedule endpoint and the feed hooks).
- Two PRs, both dark by default because nothing syncs until an admin pastes a link: PR 1 backend plus admin settings (migrations, models, fetch, parser, classifier, sync, job, endpoints, settings UI, dashboard warning); PR 2 member payload and feed integration. No feature flag exists in the app and none is added.
- Migrations are additive. The recurring job entry ships with PR 1 and is a no-op until a connection exists.
- `ANTHROPIC_API_KEY` must be set on Railway before PR 1 deploys; the API refuses to boot in production without it. Use a key from a dedicated Anthropic workspace so the spend shows up on its own line.
- Before merge of PR 1: run `bin/classifier-eval` against the live model, then connect the real calendar against a local API pointed at the seeded demo house and read the verdicts and reasons.

## 15. Open questions for Bass (with the default this spec assumes)

1. Encrypt the stored link? Default: no, plaintext with masking and log redaction, consistent with member tokens. Turning on Active Record encryption is a separate hardening ticket that adds three Railway env vars and would cover member tokens too.
2. Model: Haiku 4.5 (default) or Sonnet 5? Haiku is about a fifth of the price and should be plenty for one-line titles; the eval in section 12 is the evidence either way, and switching is one constant.
3. Per-event override in the app when the model gets a title wrong? Default: no; rename the event in Google Calendar, which changes the fingerprint and gets a fresh verdict within the hour.
4. Away housemates in the hand-off sheet: deprioritised but selectable (default), or hidden?
5. Sync cadence: hourly (default). Google caches the feed for one to two hours, so more often buys nothing.
6. Show timed events with their start time in the member feed: yes (default), in the group's zone.
7. Classify inline on connect (default, five to fifteen seconds behind a "Connecting" button) or store the events unsorted, return immediately, and let a job classify them within a minute while the card shows "Sorting events"? Inline is less code; background is the nicer form submit.
8. Show the model's one-line reason next to each verdict in "What we found": yes (default). It costs a few output tokens per title and is the fastest way to see why a title was read the way it was.
