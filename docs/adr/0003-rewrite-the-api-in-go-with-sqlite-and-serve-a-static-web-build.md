# Rewrite the API in Go on SQLite, and serve a static web build from the same binary

- Status: accepted
- Date: 2026-10-12
- Related: [ADR 0002](0002-host-rota-monster-on-the-mac-mini-behind-a-cloudflare-tunnel.md), [memory report](https://claude.ai/artifact/L6HWjGBz7Pzs1vRxos9YWh)

## Context

Production idles at about 1.4 GB across three processes, measured on Railway from 5 to 12 October 2026: Rails API 1.02 GB, Next.js 0.30 GB, Postgres 0.12 GB. ADR 0002 moves it to a Mac mini, where that memory is shared with everything else the machine does. The app is small: about 10,000 lines of Ruby under `apps/api/app`, about 40 controller actions in `apps/api/config/routes.rb`, 7 scheduled jobs, and 21 Next pages. Its behaviour is pinned by 1,597 RSpec examples in 102 files and 54 Vitest files.

## Decision

Production becomes one Go binary with an embedded SQLite database. It serves the Next app as a static export, owns WorkOS sign-in and the session cookie, runs the scheduled jobs and the SMS sender in-process, and runs no Node or Postgres. The target is an idle footprint in the tens of MB.

### 1. Order: the web goes static first, then the API moves in one cutover

There is no strangler on the database. A strangler with Rails and Go sharing a database puts Go on Postgres first and then needs a second dialect switch. It also splits SMS sending across two runtimes, and the double-text guard is a conditional `UPDATE` on one row (`apps/api/app/jobs/send_sms_job.rb:133-136`). We would write the data layer twice and put the money path at risk while doing it.

The seam is the session instead. Phase A builds a Go edge with no database. It does the WorkOS code exchange and refresh, keeps the access and refresh tokens in an AES-GCM sealed cookie (the same approach as AuthKit's), serves the static build, and reverse-proxies `/api/*`, `/public/*` and `/webhooks/*` to Rails. When it proxies, it adds `Authorization: Bearer` from the session, which is what `apps/web/src/lib/api/http.ts:43` does today, so `apps/api/app/controllers/concerns/authenticatable.rb:86` does not change. It also sets `X-Forwarded-For` from `CF-Connecting-IP`, because Rails would otherwise see one loopback address and the per-IP enumeration throttle (`rack_attack.rb:57-61`) would apply to everyone at once. Phase A drops Node first and never puts Go on Postgres. Phase B builds the Go API on SQLite, which serves no traffic until it passes the contract suite (section 5). Then a single cutover copies the data and stops the proxying. Rails and Postgres stay installed but stopped for 14 days as the rollback.

Every admin signs in again once at the Phase A switch, because AuthKit's cookie cannot be read by Go.

### 2. Static export: what blocks it and what replaces it

| Today | Replacement |
|---|---|
| `src/proxy.ts` AuthKit proxy and the `unauthenticatedPaths` gate | Go checks the session cookie before it serves an admin page, and redirects to WorkOS when there is none |
| `src/proxy.ts` first-touch cookie (`FIRST_TOUCH_COOKIE` from UTM params, read into `groups.first_touch`) | Go sets the same cookie with the same encoding and caps, before it serves any page |
| `app/callback/route.ts`, `app/auth/sign-in/route.ts` (PKCE, `onSuccess` sign-in record) | Go handlers for the PKCE state, the code exchange through `workos-go`, and the same `POST /api/sign_ins` call |
| 10 `"use server"` files, 20 `revalidatePath` calls | Client-side `fetch` to Go with the cookie, and a refetch after each mutation. Go checks `Origin` on every non-GET, because server actions did that for us |
| `lib/api/http.ts` (`server-only`, bearer token) | Browser fetches are same-origin, so the token never reaches JS on admin pages and `rack-cors` goes |
| `force-dynamic` pages, `page.tsx:53` `withAuth()` redirect on `/` | Client components. Go sends a signed-in visitor at `/` a 302 to `/dashboard` before it serves `index.html` |
| Dynamic segments `/s/[token]`, `/h/[slug]`, `/rotas/[id]`, `/super-admin/groups/[id]` | Each segment is exported once with a placeholder param. Go rewrites any matching path to that shell, and the client reads the param from `location`. `/s/<token>` URLs already sit in members' SMS history and keep working |
| `app/api/analytics/route.ts` (token bucket, daily visitor HMAC, `x-forwarded-for`) | A Go handler that reads `CF-Connecting-IP` and, until cutover, forwards to `internal/analytics/events` with the shared secret. The visitor digest must match byte for byte, or `daily_visitors`' unique `(day, digest)` (`daily_visitor.rb:60`) counts every visitor twice on switch day |
| Sentry `tunnelRoute: "/monitoring"` (`next.config.ts:77`) | A Go handler that forwards envelopes only to our own EU DSN host |

`opengraph-image.tsx`, `sitemap.ts` and `robots.ts` are not blockers. They read no request data (`opengraph-image.tsx:43`), and Next prerenders metadata routes in an export. The public homepage keeps its HTML, JSON-LD and card image, now prerendered, so nothing changes for SEO. No page uses `next/image`.

One security posture changes. `/s/[token]/page.token-safety.test.ts` guarantees that the member token never reaches the client. In a static build the browser reads the token from its own URL and sends it as a bearer header. The token is already in the URL bar and in history, so the only new exposure is to script running on the page. Go answers with `Content-Security-Policy: script-src 'self'` and `Referrer-Policy: no-referrer`, and that test is replaced by a header test on Go.

### 3. SQLite

First, ADR 0001's owed follow-up ships: `rotas.reminder_offsets` (`schema.rb:184`) and `rotas.message_template` are dropped, and `rota.rb:87-88` stops writing them. SQLite then never needs an array type.

| Postgres feature | SQLite replacement |
|---|---|
| `DISTINCT ON (name)` (`job_run.rb:102`) | `ROW_NUMBER() OVER (PARTITION BY name ORDER BY ...) = 1` |
| `date_trunc('week', ...)::date` (`group_report.rb:186`) | `date(created_at, 'weekday 0', '-6 days')`, which gives the ISO Monday that `group_report.rb:190` relies on |
| `EXTRACT(EPOCH FROM ...)` (`traffic.rb:250`) | `(unixepoch(a) - unixepoch(b)) / 3600.0` |
| `ILIKE` (`super_admin/groups_controller.rb:136`) | `LIKE`, which only folds ASCII case. That is enough for an operator search box |
| `pg_advisory_xact_lock` (`household_entry.rb:14`) | `BEGIN IMMEDIATE` |
| `with_lock` / `lock!` / `.lock` (`rotas_controller.rb:48`, `rota_regenerator.rb:64`, `shift_cover.rb:44-45`, `member_removal.rb:55`) | `BEGIN IMMEDIATE` |
| `md5(random())` slug default (`schema.rb:118`) | A slug generated in Go with `crypto/rand` |
| `::text` casts in CHECKs (`schema.rb:94,190,243-246`) | The same `IN (...)` checks, without the casts |
| `jsonb` (`analytics_events.properties`, `groups.first_touch`, `job_runs.details`) | `TEXT CHECK (json_valid(...))`. SQLite has `->>` and `FILTER (WHERE)`, so `traffic.rb` and `spend.rb` keep that SQL |
| `insert_all`/`upsert_all ... unique_by` | `INSERT ... ON CONFLICT DO NOTHING / DO UPDATE` on the same unique indexes, including the partial reminder index |
| Solid Cache (`spend.rb:367`, `overview.rb:63`, `traffic.rb:459`) | An in-process TTL map |

Writes are serialised. There is one write connection, every write transaction that reads before writing opens with `BEGIN IMMEDIATE`, and the database runs in WAL mode with `busy_timeout`, `foreign_keys=ON` and `synchronous=NORMAL`. Reads use a separate pool. With a single writer, everything the row locks and the advisory lock guarded is serialised for free. For example, `shift_cover.rb`'s re-read still returns not-found when a regeneration has deleted the shift. One rule follows: no network call (Twilio, WorkOS, a calendar fetch, Claude) is made inside a write transaction. Timestamps are stored as UTC text with exactly six fractional digits, so string order is time order. Dates are `YYYY-MM-DD`.

Data moves with a `migrate-from-pg` subcommand of the binary. It reads Postgres through `pgx` and writes SQLite table by table in foreign-key order in one transaction, keeping ids. It then compares row counts and a per-table checksum, and it can run in reverse for rollback. The queue and cache databases (`database.yml:59-68`) are not copied. At cutover the steps are: stop Rails' job worker; wait until no `sms_messages` row is `pending`; stop the API; run the copy; start Go; repoint the tunnel. The sweep reconciles hourly with a 24-hour staleness window (`reminder_sweep.rb:25,97`), so a short outage makes texts late, not lost.

### 4. Go stack

- Standard library `net/http` with Go 1.22 method patterns. No router dependency.
- `modernc.org/sqlite`: pure Go, so `CGO_ENABLED=0` builds and CI need no C toolchain. It is slower than `mattn/go-sqlite3`, but not at our load.
- Plain `database/sql` with hand-written SQL, and no ORM or sqlc. There are about 40 endpoints, and the super-admin reports are raw SQL already.
- Migrations are embedded SQL files applied against `PRAGMA user_version` by a small in-binary runner.
- Scheduler: one goroutine with a minute ticker runs the 7 entries in `config/recurring.yml` that remain (the Solid Queue cleanup goes with Solid Queue) and writes `job_runs` rows as now. `recurring.yml` documents that a missed run costs nothing, so no cron library is needed.
- No generic job queue. The `pending` `sms_messages` row already is the job (`reminder_sweep.rb:15-16,119-127`). A sender goroutine polls pending rows, and a nudge channel wakes it on each insert. It claims a row with the same conditional `UPDATE`, releases the claim on a transient failure, and keeps the roughly two-hour retry window ADR 0002 sets on `send_sms_job.rb:20`, keeping its retry state in new `attempts` and `next_attempt_at` columns. A row left in `sending` by a crash stays "needs investigation". Calendar sync, the price backfill and the signup alert run as goroutines.
- WorkOS: `golang-jwt/jwt/v5` with `MicahParks/keyfunc/v3` for JWKS, with the issuer and audience checks of `workos_access_token.rb:64-73`, and `workos-go` for the code exchange, refresh, profile and directory.
- `twilio-go` for sending, pricing and `RequestValidator`. The webhook signature is computed against the configured public URL, not the tunnel's `Host`.
- `anthropic-sdk-go` for `calendar_classifier.rb`.
- `arran4/golang-ical` and `teambition/rrule-go` replace `icalendar` and `ice_cube`. `nyaruka/phonenumbers` replaces `phonelib`.
- `time.LoadLocation` with `time/tzdata` embedded, so group time zones do not depend on the host's zoneinfo.
- `getsentry/sentry-go`, with `sentry_scrubber.rb` ported.
- The four `rack_attack.rb` throttles (lines 51, 57, 74, 93) become per-process token buckets, which is the granularity `rack_attack.rb:25` already chose.

### 5. Proving parity

The RSpec suite is the specification, and two layers check against it.

1. **HTTP contract suite.** A Rails task seeds a fixed dataset. The harness records every route in `routes.rb` against Rails, covering the happy path, a 401, a cross-tenant 404 and a validation error for each, and commits the JSON as golden files with ids and timestamps normalised. The same seed reaches SQLite through `migrate-from-pg`, which also tests the copy, and the suite then replays against Go. A test JWKS served by the harness signs tokens for both servers. A route is not ported until its goldens pass.
2. **Ported unit specs first.** Before any HTTP work, the specs for `reminder_sweep`, `send_sms_job`, `Group#today` and time zones, `shift_generator`, `household_entry` and `calendar_parser` are ported to Go table tests, with their ICS fixtures.

Before cutover, both stacks run against a copy of production at one frozen clock, and the set of `(shift, reminder)` claims each sweep would make must be identical. `bin/classifier-eval` runs against the Go classifier on the same titles.

### 6. Size and risk

About 27 agent-days: contract suite 2; ADR 0001 column drop 0.5; Phase A (Go edge, web export) 7.5; Phase B (schema, copy tool and Go API) 15.5; rehearsal and cutover 1; Rails removal 0.5. The riskiest parts, in order: a double or lost text across cutover; `send_moment` across DST changes (`reminder_sweep.rb:95-110`); tenancy scoping rewritten by hand in SQL (`tenant_scoped.rb:27-31`); RRULE expansion that differs from `ice_cube`; and `/s/<token>` links that stop resolving.

## Consequences

- Easier: one process, one file to back up, and one deploy artifact on the Mac mini. There is no Node or Postgres to patch.
- Harder: the app has two codebases until cutover, and every behaviour change in that window has to land in both or wait. We freeze API features during Phase B.
- SQLite caps us at one machine and one writer. That suits a Mac mini and would need revisiting before any multi-host setup.
- Admins sign in again once. The member token now reaches page script, protected by CSP.
- We owe: the contract suite as a permanent CI job, the Go job-run telemetry the overview reads (`job_run.rb:97-106`), and deleting `apps/api` after the rollback window.

## Alternatives considered

- **Keep Rails, tuned (jemalloc, Solid Queue in Puma, Postgres).** Lost because a tuned Rails plus Postgres still idles at several hundred MB, an order of magnitude above the goal.
- **TypeScript on Cloudflare Workers and D1.** Lost because ADR 0002 puts production on the Mac mini, and Workers would move us onto a third host with its own limits on cron and CPU time.
- **Go API, keep the Next server.** Lost because Node stays resident at about 0.30 GB, and WorkOS sessions would stay split across two runtimes.
- **Go with server-rendered templates and htmx.** Lost because it rewrites 21 working React pages and their 54 test files, not just their data fetching.
- **Go, keep Postgres.** Lost because Postgres is a second process to run, back up and upgrade, and the app's write load fits one SQLite writer.
