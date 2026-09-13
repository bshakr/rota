# Super admin: group management, traffic, and per-group dashboards

**Date:** 2026-09-12
**Status:** Plan, awaiting review
**Builds on:** [`../specs/2026-07-13-houserota-design.md`](../specs/2026-07-13-houserota-design.md) (tenancy, auth, data model) and [`../specs/2026-09-12-rota-monster-soft-clay-design.md`](../specs/2026-09-12-rota-monster-soft-clay-design.md) (visual direction). `docs/household-entry.md` lists super admin as parked. This un-parks it.

## Problem

Rota Monster is multi-tenant, but the only person who can see a house is one of its admins. The operator cannot answer: how many houses exist, which ones are alive, who signed in and never made a house, why a house's texts are failing, or whether the product is converting at all. Everything below serves one operator role: **super admin**.

Four surfaces were asked for:

1. Group management (list, inspect, act on houses).
2. Traffic dashboard: conversion and usage.
3. Group dashboard: one house's usage and health.
4. Overall super admin dashboard.

## What exists that this leans on

- **Auth boundary.** Every `/api/*` admin request verifies a WorkOS JWT (`WorkosAccessToken`) and scopes everything through `TenantScoped#group_scope`. `Authenticatable` has a comment marking exactly where a role gate belongs. Super admin does not widen this seam; it gets its own, beside it.
- **JIT provisioning.** `users`, `groups`, `group_admins` are created from claims on first request, with `created_at` on every row. That is already a sign-up timeline.
- **The SMS log is an event log.** `sms_messages` rows carry `kind` (reminder, cover_notice, member_login), `status`, `error_code`, `created_at`, `sent_at`. A `cover_notice` is a cover happening. A `member_login` is a member asking for their link. Usage is mostly already recorded.
- **The dashboard warning collector** (`apps/web/src/lib/dashboard.ts`) is pure data in, warnings out. The per-group super admin view reuses it unchanged.
- **Soft Clay** and its lint (no raw colours, no gradients, tokens only) apply to every new screen.

## What does not exist

- **No notion of a super admin.** Tokens without `org_id` are refused outright, and there is no role above "member of this org".
- **No traffic data at all.** No page view counting, no sign-in record, no "last seen". A user who signs in and abandons `/setup` never reaches Rails, so today they are invisible. The conversion funnel's top is unrecorded, and it cannot be backfilled. **Instrumentation therefore ships first**, before the dashboards that read it.
- **No suspend or archive on a group.** The only lever an operator has is the WorkOS dashboard.
- **No chart component.** Nothing in `apps/web` draws a bar or a sparkline.

## Decisions

| Decision | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Who is a super admin | Env allowlist of WorkOS user ids, `SUPER_ADMIN_WORKOS_USER_IDS`, read by Rails and by Next from the one root `.env` | A `users.super_admin` column; a "staff" WorkOS organisation; a WorkOS role; an allowlist of emails | Granting god mode should be a deploy, not a click, and never reachable through the API. `sub` is in every token already; an email allowlist would first need the WorkOS JWT template changed to add an `email` claim. A staff org would fight the one-org-per-token model. |
| Enforcement | Rails, in a new `SuperAdmin::BaseController` that verifies the JWT and checks the allowlist. Next repeats the check only to hide the nav and 404 the route | Next-only gating | Rails owns everything that matters. The Next check is cosmetic. |
| Refused caller sees | 404 | 403 | Matches the tenancy rule: a surface you cannot use should look like one that does not exist. |
| Scoping | Super admin controllers deliberately do **not** include `TenantScoped`. Cross-tenant reads are the point and are explicit | Reusing `group_scope` with an escape hatch | An escape hatch in the tenant seam is the one bug nobody gets to make quietly. Two base controllers, two invariants, each tested. |
| Tokens without `org_id` | Accepted on super admin routes and on `POST /api/sign_ins`; still refused everywhere else | Requiring the operator to always have a house selected | A super admin may have no house. And a sign-in with no house yet is exactly the funnel step we most need to record. |
| Suspend, not delete | `groups.suspended_at`. Suspended: admin API answers 403 `group_suspended`, reminder sweep skips it, member pages say paused. Nothing is deleted | Hard delete in v1 | Delete cascades through shift history and needs a WorkOS org deletion too. Suspend is reversible and covers abuse and cost control. Delete is a later phase. |
| Member PII shown to super admin | Phone numbers shown in full; magic-link tokens never returned; `/s/<token>` lines redacted from SMS bodies | Masking phone numbers | The operator needs the number to diagnose a wrong-country or duplicate-number delivery failure. The token is a different matter: it is a permanent login to someone else's house, and the operator never needs it. |
| Identity funnel events | First-party: `POST /api/sign_ins` from the AuthKit callback, authenticated by the same WorkOS JWT | A shared internal secret; a third-party analytics SDK | Reuses the one trust model. No new secret, no cookies, no vendor. |
| Anonymous page traffic | Optional last phase: `page_views` daily counters (day, path, referrer host), no IP, no cookie, written from Server Components via `after()` | Plausible or PostHog script in the landing page | Kept first-party to match the app's stance on data. If richer geo/referrer analytics is wanted later, Plausible is the drop-in and this phase is skipped. Decide when the phase arrives. |
| Aggregation | Live SQL in `SuperAdmin::*` query objects, cached 60s in Solid Cache, plus two indexes | Materialised daily stats tables | Tens of houses, not thousands. Add rollups when a page takes over 500ms, not before. |
| Charts | Flat pastel bars and inline SVG sparklines, hand-rolled, tokens only | Recharts or similar | Soft Clay forbids gradients and raw colours, the lint would fight a library, and the charts needed are bars and lines. |
| Impersonation | Not built. Link to WorkOS dashboard impersonation | In-app "open as this house's admin" | WorkOS already does it with an audit trail. |

## Data model changes

```
groups          + suspended_at        datetime, null      ← the management lever
                + notes               text, null          ← operator-only, never served to house admins

users           + last_seen_at        datetime, null      ← throttled touch, see below

sign_ins        id, user_id → users, workos_organization_id (null), created_at
                index (created_at), index (user_id, created_at)

members         + last_seen_at        datetime, null      ← "did anyone open their link"

sms_messages    + index (created_at)  plain, alongside the partial member_login one

page_views      day date, path string, referrer_host string (null), count integer   (Phase 5)
                unique (day, path, referrer_host)
```

**Why `sign_ins` is a table and not a column.** Weekly active admins, returning users, and "signed in N times before making a house" all need history. A `last_sign_in_at` column answers only one question.

**The throttled touch.** `GroupAdmin.provision!` deliberately writes nothing on the steady-state read path, and a spec proves it. `last_seen_at` must not undo that. Rule: write only when NULL or older than one hour, so an admin costs one UPDATE per hour at most. The zero-writes spec becomes "no writes within the hour after a touch". Same rule for `members.last_seen_at` in `MemberAuthenticatable`.

## API

All under one new namespace, none of it `TenantScoped`:

```
GET    /api/super_admin/overview                       KPIs, attention list, recent houses
GET    /api/super_admin/traffic?range=7d|30d|90d       funnel + usage series
GET    /api/super_admin/groups?q=&status=&sort=        list with per-row counts
GET    /api/super_admin/groups/:id                     everything the group dashboard shows
PATCH  /api/super_admin/groups/:id                     name, timezone, notes
POST   /api/super_admin/groups/:id/suspend
DELETE /api/super_admin/groups/:id/suspend             resume
GET    /api/super_admin/groups/:id/sms_messages        redacted, same filters as the house's own log
```

And one endpoint outside it, for instrumentation:

```
POST   /api/sign_ins        any verified WorkOS token; org_id optional; upserts the user, inserts a row
```

Controller shape:

```ruby
module SuperAdmin
  class BaseController < ApplicationController
    abstract!
    include SuperAdminAuthenticatable   # verify JWT, allow missing org_id, require sub in allowlist, else 404
    include ApiErrorRendering
  end
end
```

`WorkosAccessToken.verify!` grows an `allow_missing_organization:` keyword. The default stays strict, so nothing about the existing admin path changes.

The allowlist is parsed once at boot into a frozen set of trimmed ids; an empty or unset variable means nobody.

Serializers are separate from the house-facing ones (`SuperAdmin::GroupSerializer`, `SuperAdmin::MemberSerializer`, `SuperAdmin::SmsMessageSerializer`) so redaction is structural: the house's `MemberSerializer` includes `access_token` on purpose, and the super admin one cannot, because it is a different class.

## Web

A new route group `apps/web/src/app/(super-admin)/` with its own layout and shell, at `/super-admin/*`. Not under `(admin)`: that layout requires a selected household and wears the house's navigation.

```
/super-admin                       overall dashboard
/super-admin/traffic               conversion and usage
/super-admin/groups                group management list
/super-admin/groups/[id]           group dashboard + actions
```

- `requireSuperAdmin()` beside `requireHousehold()`: `withAuth()`, then `auth.user.id` in the allowlist, else `notFound()`. No household needed.
- `src/lib/api/super-admin.ts`: a second server-only client, same `requestJson`, but it takes the token from `withAuth()` directly rather than `requireHousehold()`.
- The proxy matcher already covers `/super-admin/*` (everything not excluded is protected), so a logged-out visitor is bounced to WorkOS before the layout renders. `proxy-matcher.test.ts` gets one assertion saying so.
- The house `AdminShell` shows a "Super admin" link in its footer only when the layout passes `superAdmin: true`. The super admin shell links back to "Your house".
- The super admin shell must not be mistakable for a house. A plum band across the top with the wordmark and the word **HQ**, in both registers. Everything else is ordinary Soft Clay.
- Charts: `src/components/charts/bars.tsx` (flat pastel bars on the quiet fill, values as Fredoka numerals) and `sparkline.tsx` (inline SVG, `stroke: currentColor`, `text-link`). Both take arrays of `{ label, value }` and nothing else. Load the `dataviz` skill when building them.

## The four surfaces

### 1. Group management (`/super-admin/groups`)

List, one row per house, sortable and searchable by name or slug:

- name, slug, timezone (with an unconfirmed marker), created
- admins, active members, running rotas, draft rotas
- texts in the last 7 days and how many failed
- last activity: the latest of last SMS sent, last admin seen, last member seen
- status pill: **Live**, **Quiet** (no activity 30 days), **Never started** (no running rota), **Suspended**

Filters: status, unconfirmed timezone, has failures. Row click opens the group dashboard.

Actions, all on the group dashboard rather than inline, each behind the existing `ConfirmDialog`:

- **Suspend / Resume.** The dialog names what suspension does: reminders stop, admins see a paused screen, members see a paused page, nothing is deleted.
- **Rename / set timezone.** Same semantics as the house's own PATCH: sending a timezone stamps `timezone_confirmed_at`, so the house's own "confirm your timezone" warning goes away. A super admin setting it counts as a human confirming it. The audit of *who* set it is the Rails log line, which names the super admin's `sub`.
- **Notes.** A free-text box only super admins see. "Trial house for the school run", "Bassem's own".

Not in this slice: create a house, add or remove a house admin, delete. See Later.

### 2. Traffic dashboard (`/super-admin/traffic`)

Range picker: 7, 30, 90 days. Two halves.

**Conversion.** A funnel of counts within the range, each step a bar, each with its rate from the previous step:

1. Landing views (Phase 5 only; shown as "not tracked yet" until then)
2. Signed in (`sign_ins`, distinct users)
3. Made a house (`groups.created_at`)
4. Confirmed the timezone (`timezone_confirmed_at`)
5. Added a member
6. Started a rota (a rota with at least one position)
7. First text delivered (`sms_messages` status delivered, kind reminder)
8. First cover (`cover_notice`)

Steps 3 to 8 are computable today from existing tables. Step 2 needs `sign_ins`. Beside the funnel: median hours from sign-in to first delivered text, and the count of users who signed in but have no house (the leak this dashboard exists to expose).

**Usage.** Weekly series across the range:

- texts sent, split by kind (stacked bars: reminder lilac, cover notice sky, personal link peach)
- delivery rate, and failures by `error_code` (a small table, the top five)
- covers per week (`cover_notice` rows), the product's one engagement number
- active houses (a delivered text in the window), active admins (`sign_ins` or `last_seen_at`), members who opened their link (`members.last_seen_at`)
- new houses per week

### 3. Group dashboard (`/super-admin/groups/[id]`)

The house's own dashboard as the operator sees it, plus what the house cannot see about itself.

- Header: name, slug, timezone, created, status pill, the actions above.
- **Warnings**, from `collectDashboardWarnings` with the same inputs, so the operator sees exactly the alerts the house admin sees.
- **Admins:** name, email (placeholder addresses shown as "not provided"), WorkOS role, last seen, sign-in count. A link to that user in the WorkOS dashboard.
- **Members:** name, phone number, status (active, opted out, removed), rotas they sit on, last opened their link. No token, no copy-link button.
- **Rotas:** name, schedule in words, roster size, draft or running, reminder offsets, send hour.
- **Upcoming shifts:** next 14 days, covers marked.
- **Usage sparklines:** texts per week and covers per week for the last 12 weeks.
- **SMS log:** the house's log with the same filters, bodies with the magic-link line replaced by `Manage: [link]`.
- **Notes.**

### 4. Overall dashboard (`/super-admin`)

The landing page of the super admin area. Answers "is anything wrong, and is anything growing" in one screen.

- **KPI tiles** (the hero ledger pattern from the house dashboard, same tile component): houses total and active in the last 30 days, new houses this week, texts in the last 7 days with delivery rate, covers this week, failures in the last 7 days.
- **Attention list**, ordered by cost of ignoring: houses with failed texts in the last 7 days; houses with an unconfirmed timezone older than 7 days; houses with only draft rotas older than 7 days; houses with an active member who opted out. Each row links to that group dashboard.
- **Recent houses:** the last ten created, with their furthest funnel step, so a stuck onboarding is visible the day it happens.
- **System health:** last reminder sweep finished at, last top-up finished at, Solid Queue failed executions. The two jobs each write a `job_runs` row (or a Solid Cache key) when they finish, because `clear_solid_queue_finished_jobs` deletes the evidence hourly.
- Link to Traffic for the series.

## Suspension, precisely

`suspended_at` set means:

- `Authenticatable` (the house admin path): after provisioning, if `Current.group.suspended?` render 403 `{ error: "group_suspended" }`. `/api/me` is exempt so the web app can render the paused screen with the house's name.
- Web `(admin)` layout: on `group_suspended` render a paused screen instead of the shell. Copy in the house voice: "This house is paused. Nothing is lost. Email us to pick it back up."
- `ReminderSweep` and `TopUpShiftWindowsJob`: `Rota.active.joins(:group).merge(Group.live)` where `live` is `suspended_at IS NULL`. Reminders are not claimed, so resuming a house does not fire a backlog: the 24-hour staleness guard buries anything older, exactly as after an outage.
- Member path (`/api/member/*`) and household entry (`/public/households/*`): 200 with `{ paused: true }` shape, the pages render a quiet paused notice. Covers refused with `group_suspended`.
- Twilio status webhook: unaffected, a receipt for a text already sent still lands.

## Testing

In priority order, matching the spec's own list.

1. **The allowlist is the boundary.** A request spec walks every `/api/super_admin/*` route with a valid, correctly provisioned house admin token whose `sub` is not allowlisted and asserts 404 on all of them, and that no row changed. Then the same routes with an allowlisted `sub` return 200. A third case: allowlist unset means nobody, including in development.
2. **Redaction is structural.** A spec serialises a group with members and messages through the super admin serializers and asserts the JSON contains no member `access_token` and no `/s/` followed by a token. Phone numbers are expected to be present.
3. **Suspension.** Suspended house: admin routes 403, `/api/me` 200, sweep creates no `sms_messages` rows for it, top-up creates no shifts, member cover refused, resume restores all four, and no reminder older than 24 hours fires after resume.
4. **Aggregates.** Each `SuperAdmin::*` query object with factories and `travel_to`: funnel step counts and rates, weekly bucketing across a DST change and a month boundary, active-house definition, attention list ordering.
5. **The touch is throttled.** `last_seen_at` written once, then not again within the hour, and the existing zero-writes spec still holds inside that hour.
6. **`POST /api/sign_ins`** accepts a token with no `org_id`, refuses a bad signature, and is idempotent per `jti`.
7. **Web.** Vitest for the pure pieces: funnel maths, allowlist parsing, `proxyMatches("/super-admin/groups/1")`. A `super-admin.test.ts` mirroring `admin.test.ts` for the client. The bundle-safety grep extends to the allowlist env var, which must never reach the browser.

Brakeman will flag the cross-tenant queries as mass-lookup patterns. Annotate the one place per controller where an unscoped `Group.find` is intended, and say why in the comment.

## Rollout

1. Migration first, in its own deploy: `suspended_at`, `notes`, `last_seen_at` columns, `sign_ins`, indexes. All additive and nullable. Previous code keeps running against the new schema.
2. Code deploy. `SUPER_ADMIN_WORKOS_USER_IDS` unset means the whole area 404s and no nav link shows, so the deploy is inert until the variable is set on Railway. Find your own id (it starts with `user_`) in the WorkOS dashboard under Users, at `/api/me` as `workos_user_id`, or with `bin/rails 'workos:inspect_token[<jwt>]'`.
3. Set the variable, restart, check `/super-admin` renders and a second (non-allowlisted) account gets the 404.
4. No real SMS is involved anywhere in this work. Local QA runs on the null adapter and the demo seeds, extended with a second and third demo house so the list, the funnel and the attention list have something to show.

## Phases

Each phase is one PR and leaves `main` shippable. Instrumentation is deliberately early: dashboards can wait, data cannot.

**Phase 0: the seam and the collectors.**
Allowlist config in Rails and Next. `SuperAdminAuthenticatable`, `SuperAdmin::BaseController`, an empty `overview` endpoint. `(super-admin)` route group, `requireSuperAdmin`, shell with the HQ band, nav link. Migration for `sign_ins` and both `last_seen_at` columns. `POST /api/sign_ins` wired from the AuthKit callback's `onSuccess` (check the exact hook name against the installed `@workos-inc/authkit-nextjs` typings before relying on it). Throttled touches. Tests 1, 5, 6. From this PR on, the funnel is being recorded.

**Phase 1: group management.**
Migration for `suspended_at` and `notes`. Groups list and show endpoints with the super admin serializers. Suspension enforced in all five places above. The list screen and a first cut of the group page carrying only header, admins, members, rotas, notes and the three actions. Tests 2, 3.

**Phase 2: overall dashboard.**
`SuperAdmin::Overview` query object, `job_runs` for system health, the KPI tiles, attention list and recent houses. Test 4 for overview.

**Phase 3: group dashboard, completed.**
`SuperAdmin::GroupReport`: warnings via the shared collector, upcoming shifts, usage sparklines, redacted SMS log with filters. The sparkline and bars components arrive here.

**Phase 4: traffic.**
`SuperAdmin::Traffic` with the funnel and weekly series, the range picker, the stacked bars, failures by error code. Test 4 for traffic. Landing views shows "not tracked yet".

**Phase 5 (optional): anonymous traffic.**
Decide first between first-party `page_views` counters and Plausible. If first-party: the table, `POST /internal/page_views` behind `INTERNAL_API_TOKEN`, fire-and-forget from `/` and `/h/[slug]` via `after()`, and the funnel's first step lights up. Bots inflate it; say so on the tile.

## Later, deliberately

- **Invite a house.** Create a WorkOS organisation and send an invitation to an email, from the super admin area. `initialHousehold` in `apps/web/src/lib/auth/household.ts` is most of the code.
- **Admin membership management.** Add or remove a house admin through the WorkOS memberships API.
- **Hard delete**, with the WorkOS org deletion and a typed-name confirmation.
- **CSV export** of the groups list and the traffic series.
- **SMS cost.** Once Twilio pricing per segment is worth tracking, a `segments` column on `sms_messages` turns the usage chart into a bill.
