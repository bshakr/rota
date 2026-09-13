# Super admin: epic and tickets

Breakdown of [`2026-09-12-super-admin.md`](2026-09-12-super-admin.md) into Linear issues for the
Rota Monster project. One parent issue (the epic), one child per ticket below. Each ticket is one
PR and leaves `main` shippable. Order within a phase is the order to ship. A ticket names the plan
section it implements rather than repeating it.

## Epic: Super admin area

Operator-only surface for Rota Monster: manage houses, see conversion and usage, see what each
house costs in Twilio texts and Claude calls, and inspect one house's health. Plan:
`docs/superpowers/plans/2026-09-12-super-admin.md`.

Done when all five surfaces are live behind `SUPER_ADMIN_WORKOS_USER_IDS`, every non-allowlisted
account gets a 404, and the spend page shows real Twilio and Claude figures per house.

---

## Phase 0: the seam and the collectors

### 0.1 Super admin auth seam (API)

Rails half of the boundary. Plan sections: Decisions (who is a super admin, enforcement, refused
caller, scoping, tokens without org_id), API.

- `SUPER_ADMIN_WORKOS_USER_IDS` parsed at boot into a frozen set; unset means nobody.
- `WorkosAccessToken.verify!` gains `allow_missing_organization:`; default stays strict.
- `SuperAdminAuthenticatable` concern and `SuperAdmin::BaseController` (no `TenantScoped`).
- `GET /api/super_admin/overview` returning an empty payload, so the route exists to test.
- Request spec: valid non-allowlisted token gets 404 on every super admin route and changes no
  row; allowlisted gets 200; unset allowlist means 404 for everyone; token with no `org_id` is
  accepted here and still refused on `/api/me`.

### 0.2 Super admin shell (web)

Next half. Plan section: Web.

- `requireSuperAdmin()` beside `requireHousehold()`; `notFound()` when not allowlisted.
- `src/lib/api/super-admin.ts` client taking the token from `withAuth()` directly.
- `(super-admin)` route group, layout, shell with the plum HQ band, `/super-admin` rendering an
  empty overview.
- "Super admin" link in the house `AdminShell` footer only when the layout passes the flag; the
  super admin shell links back to "Your house".
- `proxy-matcher.test.ts` asserts `/super-admin/groups/1` is proxy-protected; bundle-safety grep
  extended to the allowlist env var.

### 0.3 Sign-in and last-seen collectors

Plan sections: Data model (`sign_ins`, `last_seen_at`, the throttled touch), API (`POST
/api/sign_ins`).

- Migration: `sign_ins` table, `users.last_seen_at`, `members.last_seen_at`.
- `POST /api/sign_ins`: any verified WorkOS token, `org_id` optional, upserts the user, inserts a
  row, idempotent per `jti`.
- Wired from the AuthKit callback's success hook (confirm the hook name against the installed
  `@workos-inc/authkit-nextjs` typings).
- Throttled touch in `Authenticatable` and `MemberAuthenticatable`: write only when NULL or older
  than one hour. The existing zero-writes spec becomes "no writes within the hour".
- Specs: touch written once then not again within the hour; sign-ins endpoint accepts an org-less
  token, refuses a bad signature, dedupes by `jti`.

### 0.4 Spend collectors: Twilio segments and prices

Plan sections: Decisions (Twilio cost), Data model (`sms_messages` columns), Rollout step 4.

- Migration: `num_segments`, `price`, `price_unit`, `price_fetched_at` on `sms_messages`, plus a
  plain index on `created_at`.
- `Sms::TwilioAdapter#deliver` returns `num_segments`; `SendSmsJob` stores it with the SID.
- `BackfillSmsPricesJob`, nightly in `recurring.yml`: rows with a SID, no `price_fetched_at`, sent
  in the last seven days; stores Twilio's negative string as a positive decimal; leaves unpriced
  rows for tomorrow.
- `bin/rails twilio:backfill_prices`: the one-off for history, oldest first, rate-limited.
- Specs: adapter returns segments (WebMock), job fetches only eligible rows and handles "not priced
  yet", rake task never sends.

### 0.5 Spend collectors: Claude calls

Plan sections: Decisions (where spend is recorded, Claude cost), Data model (`ai_calls`).

- Migration: `ai_calls` table.
- Rate table in `config/initializers/calendar_classifier.rb` beside the model name (Haiku 4.5: $1
  per million input, $5 per million output).
- `CalendarClassifier` writes one row per chunk from `message.usage`, with `cost_usd` snapshot,
  `items_count`, and `succeeded` false plus `error_class` on a 429 or malformed reply.
- Specs: row per chunk with the stubbed usage; failure row on 429; cost arithmetic; fingerprinting
  with no API key still writes nothing.

---

## Phase 1: group management

### 1.1 Groups list and detail endpoints, redacting serializers

Plan sections: API (`groups`, `groups/:id`, `groups/:id/sms_messages`), Decisions (member PII),
Testing item 2.

- `SuperAdmin::GroupSerializer`, `MemberSerializer`, `SmsMessageSerializer`: phone numbers in
  full, no `access_token`, `/s/<token>` line in bodies replaced with `Manage: [link]`.
- List with per-row counts (admins, active members, running and draft rotas, texts and failures
  last 7 days, last activity) and the status pill rules (Live, Quiet, Never started, Suspended).
- Search by name or slug; filters: status, unconfirmed timezone, has failures.
- Redaction spec greps the JSON for tokens and `/s/` links.

### 1.2 Suspend, resume, rename, timezone, notes (API)

Plan sections: Group management actions, "Suspension, precisely".

- Migration: `groups.suspended_at`, `groups.notes`.
- `PATCH groups/:id` (name, timezone stamps confirmed, notes); `POST` and `DELETE`
  `groups/:id/suspend`.
- Enforcement: house admin routes 403 `group_suspended` with `/api/me` exempt; reminder sweep and
  top-up skip suspended groups; member routes and household entry answer `paused: true`; covers
  refused; Twilio webhook unaffected.
- Specs: all five enforcement points, resume restores them, no reminder older than 24 hours fires
  after resume.

### 1.3 Groups list and group page, first cut (web)

Plan section: Group management, Group dashboard (header, admins, members, rotas, notes, actions).

- `/super-admin/groups`: the table with sort, search and filters; row click to the group page.
- `/super-admin/groups/[id]`: header with status pill, admins, members, rotas, notes, and the
  three actions behind `ConfirmDialog` with the suspension dialog naming what it does.
- House-side paused screens: `(admin)` layout on `group_suspended`, member page and household
  entry on `paused: true`, in the house voice.

---

## Phase 2: overall dashboard

### 2.1 Overview query object and job runs

Plan section: Overall dashboard.

- `job_runs` (or a Solid Cache key) written by the reminder sweep, top-up and calendar sync when
  they finish.
- `SuperAdmin::Overview`: KPI counts, attention list in the plan's order, recent houses with their
  furthest funnel step, system health. Cached 60 seconds.
- Specs with factories and `travel_to`: each KPI, attention ordering, furthest-step derivation.

### 2.2 Overview page (web)

- KPI tiles using the house dashboard's hero ledger tile, attention list linking to group pages,
  recent houses, system health, links to Traffic and Spend.

---

## Phase 3: group dashboard, completed

### 3.1 Group report query object

Plan section: Group dashboard.

- `SuperAdmin::GroupReport`: warnings input (the same shape `collectDashboardWarnings` takes),
  upcoming shifts for 14 days, weekly texts and covers for 12 weeks, admins with last seen and
  sign-in counts, members with last opened.
- Specs: series bucketing across a month boundary, warnings input matches the house's own.

### 3.2 Charts and the finished group page (web)

Plan sections: Web (charts), Group dashboard.

- `src/components/charts/bars.tsx` and `sparkline.tsx`: flat pastel, tokens only, no gradients,
  both registers. Load the `dataviz` skill before building.
- Group page gains warnings via `collectDashboardWarnings`, upcoming shifts, sparklines, the
  redacted SMS log with the house log's filters.

---

## Phase 4: traffic

### 4.1 Traffic query object

Plan section: Traffic dashboard.

- `SuperAdmin::Traffic`: funnel steps 2 to 8 with step rates, median hours from sign-in to first
  delivered text, users with no house, weekly series (texts by kind, delivery rate, failures by
  error code, covers, active houses, active admins, members who opened their link, new houses).
- Specs: funnel counts and rates, weekly buckets across a DST change, active-house definition.

### 4.2 Traffic page (web)

- Range picker (7, 30, 90 days), funnel bars with "not tracked yet" on step 1, stacked weekly
  bars by kind, failures table, the usage tiles.

---

## Phase 5: spend

### 5.1 Spend query object

Plan section: Spend.

- `SuperAdmin::Spend`: monthly totals split texts and Claude, per-house rows (settled versus
  estimated SMS cost marked separately, tokens, calls, per active member, allocated fixed cost
  from `FIXED_MONTHLY_COST_USD`), unit economics (median and p90 per house and per member, cost
  per text, per classified title).
- Specs: settled versus estimated, division with zero active members, median and p90 with one
  house and many.

### 5.2 Spend page, overview tile, group card (web)

- `/super-admin/spend` with range picker, monthly stacked bars, per-house table, unit economics,
  the candidate-price margin calculator (not stored; a vitest for the maths).
- Spend tile on the overview; spend card on the group page.

---

## Phase 6 (optional): anonymous traffic

### 6.1 Decide: first-party page views or Plausible

A decision ticket, not code. If Plausible, close 6.2 and add the script to the landing page
instead.

### 6.2 First-party page view counters

Plan section: Phase 6.

- `page_views` table (day, path, referrer host, count), `POST /internal/page_views` behind
  `INTERNAL_API_TOKEN`, fire-and-forget from `/` and `/h/[slug]` via `after()`.
- Funnel step 1 lights up; the tile says bots inflate it.
