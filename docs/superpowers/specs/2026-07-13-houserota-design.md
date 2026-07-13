# HouseRota — Design

**Date:** 2026-07-13
**Status:** Approved, ready for implementation planning

## Problem

Recurring shared chores (cleaning, bins, gear checks) need a rota: an ordered list of people
taking turns at a named job on a recurring schedule. People forget their turn, so the system
texts them. People go away, so they need to hand a turn to someone else without an admin
getting involved.

Built first for a shared house, but designed to be opened up to other groups — clubs, teams,
families — so the domain vocabulary is deliberately generic.

## Scope

**In scope**

- Admin UI to manage members (name, phone) and rotas (job, schedule, order, message).
- Multiple independent rotas per group, each with its own ordered subset of members.
- Recurring schedule: every N days / weeks / months from an anchor date.
- Custom SMS message per rota, with placeholders.
- SMS reminders at configurable day-offsets before each shift, including day-of.
- Members hand a shift to another member without logging in.

**Out of scope (deliberately)**

- Marking a chore done. Not requested; invites a completion-and-nagging surface.
- Accept/decline handshake on covers. Explicitly rejected — see Decisions.
- True shift trades (both parties' dates swap). One-off cover only.
- Billing, and SMS compliance beyond the `sms_opted_out_at` column.
- Hosting. Deferred until the system works locally — see Open Decisions.

## Decisions

Each of these was chosen over stated alternatives. The rationale matters more than the choice.

| Decision | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Member identity | Magic link, no login | WorkOS seats; two-way SMS | Phone possession is already the auth factor, since the link arrives by SMS. No onboarding, no seats. |
| Swap semantics | One-off cover | True trade; both | The rota order stays sacred; only a single shift is overridden. One nullable column. |
| Cover agreement | Unilateral record | Request + accept; open call | It's already agreed over dinner. Removes the entire state machine — no pending status, no request table. |
| Tenancy | Multi-group, multi-admin | Single house; single admin | Maps 1:1 onto WorkOS Organizations. Retrofitting tenancy later is a painful migration. |
| Recurrence | Interval from anchor date | RRULE/ice_cube; fixed presets | One integer + one unit covers weekly, fortnightly, monthly, and every-N-days without a recurrence library. |
| Reminder timing | List of day-offsets | Separate lead field + day-of flag | Day-of is simply offset `0`. Two requirements collapse into one column, one job, one code path. |
| Rota message | Template with placeholders | Static text | Personal without letting the admin break it. Live preview in the editor. |
| Shift storage | Rolling materialised window | Compute on the fly; materialise forever | Real rows to query, honest immutable history, cheap config edits. See below. |
| Stack | Next.js + Rails | Single Next.js app; Rails + Hotwire | User's call. Two deployables is the price of wanting both shadcn (React-only) and Rails. |

### Why the rolling window

Shifts are real rows, but only for a bounded window: all past shifts plus roughly the next
90 days, topped up daily.

- **Past shifts are immutable history.** Once a date passes, the row records who was actually
  responsible, cover included. Nothing ever rewrites it. (Computing shifts on the fly fails
  here: adding a member would retroactively rewrite who cleaned last month.)
- **Future shifts are derived and disposable.** Config changes delete and regenerate them.
- **Queries stay boring.** The reminder sweep is a `WHERE` clause, not a computation across
  every rota in the system.

## Architecture

Three pieces: a **Next.js app** (admin UI + member magic-link pages), a **Rails API-only app**
(all business logic, scheduling, Twilio), and **Postgres**. Rails owns everything that matters;
Next.js is a rendering and auth layer.

### Auth

WorkOS AuthKit lives in Next.js via `@workos-inc/authkit-nextjs`. Its middleware handles the
login redirect and holds an encrypted session cookie. `withAuth()` returns both an
`organizationId` and a short-lived `accessToken` — a JWT signed by WorkOS. Next.js forwards
that token to Rails as `Authorization: Bearer <token>`.

Rails never calls WorkOS to check a session. It verifies the JWT signature against WorkOS's
JWKS endpoint (`WorkOS::UserManagement.get_jwks_url`) and reads the claims: `sub` is the admin's
user ID, `org_id` is the group.

**`org_id` comes from a cryptographically signed token, not from the client.** Rails scopes
every query by the group resolved from that claim, so a compromised frontend cannot read another
group's rota. Tenancy isolation is enforced at the boundary, not by convention.

Rails stays stateless: no sessions, no cookies, no CORS cookie dance. Token refresh is entirely
AuthKit's problem, handled in Next.js middleware.

`users` and `group_admins` are **provisioned just-in-time from the verified claims** on each
authenticated request: `sub` upserts the user, `org_id` upserts the group, and the pair upserts
the `group_admins` row with its `role`. Rails holds no independent copy of WorkOS's membership
state to drift out of sync — these tables exist for foreign keys, display names, and audit, not
as a source of truth.

**The token carries no timezone, and that matters more than it sounds.** A WorkOS access token
has `sub`, `org_id`, `role` and friends — no email, no organisation name, and crucially no
timezone. So JIT provisioning fills placeholders on INSERT only, never clobbering a value a human
later set. `role` is the exception: WorkOS owns it, so it re-syncs on every request.

The timezone placeholder is the dangerous one. `groups.timezone` drives `send_hour` for every
reminder in the system. A London house provisioned as UTC, whose admin never opens a settings
screen, texts everybody an hour early from BST onwards — forever, with no error raised anywhere.
That is the exact class of silent failure this product exists to prevent.

So `groups.timezone_confirmed_at` is nullable, and NULL means *"we guessed; no human has ever
confirmed this."* Setting the timezone through `PATCH /api/group` stamps it. While it is NULL,
the dashboard shows a loud, actionable warning. A timezone the system invented is not a timezone
the system should quietly trust.

### The member auth path is a deliberate exception

Members have no WorkOS identity. Their magic link carries an opaque 32-byte URL-safe token that
maps to one member record. These routes bypass JWT auth entirely and authenticate by token
lookup. The path can only ever see one member's own shifts and perform one action (assign or
cancel a cover). Keeping it narrow is what makes it safe to hand out over SMS.

**The token is never a path segment in Rails.** `/s/<token>` exists only as the Next.js page the
SMS points at. Next.js reads the token from its route param server-side and forwards it to Rails
as `Authorization: Bearer <token>`; the Rails endpoints are `/api/member/*` and carry no token in
the URL.

This is not cosmetic. Rails' `filter_parameters` redacts query strings and request bodies but
**not path segments** — `filtered_path` passes the path through verbatim, and Rails logs it at
`info` on every request. A token in the path would therefore be written to production logs in
plaintext on every member request, and because that token is a permanent, non-expiring credential
by design, anyone with log-read access would hold a working set of member credentials. Moving it
to a bearer header puts it inside the filter that already exists, and makes the member path
structurally symmetric with the admin path.

For the same reason `config.active_job.log_arguments` is `false`: job arguments carry tokens and
phone numbers, and ActiveJob logs them at `info` too.

WorkOS Organizations is the source of truth for admin identity; Rails keeps a local `groups`
table with a `workos_organization_id`. Members and rotas are never stored in WorkOS.

## Data model

```
groups          id, workos_organization_id ᵁ, name, timezone
users           id, workos_user_id ᵁ, email, name        (JIT-upserted from JWT claims)
group_admins    id, user_id → users, group_id → groups, role

members         id, group_id, name, phone_e164, access_token ᵁ, active,
                sms_opted_out_at (nullable)
rotas           id, group_id, name, message_template,
                starts_on, interval_count, interval_unit (day|week|month),
                send_hour (default 9), reminder_offsets int[] (e.g. {3,0}), active
rota_positions  id, rota_id, member_id, position          ᵁ(rota_id, position)

shifts          id, rota_id, due_on,
                assigned_member_id,                       ← what the rota says
                covering_member_id (nullable)             ← the override
                                                          ᵁ(rota_id, due_on)

sms_messages    id, kind (reminder|cover_notice), shift_id, member_id,
                days_before (nullable), body, twilio_sid, status, error_code, sent_at
                ᵁ(shift_id, days_before) WHERE kind = 'reminder'   ← idempotency
```

**Members belong to the group, not to a rota.** Alice is entered once and can appear in the
kitchen rota, the bins rota, and the bathroom rota. `rota_positions` gives each rota its own
ordered subset.

**The override is one nullable column.** `covering_member_id` is the entire swap feature. The
member *responsible* for a shift is `covering_member_id || assigned_member_id` — one method,
used by the reminder job, the calendar, and the member page alike.

**The magic link is a token on the member, not on the shift.** One stable link per person,
included in every SMS, showing all their upcoming shifts across every rota in the group.
Rotatable by an admin if a phone is lost.

**The partial unique index is the reminder engine's safety net.** `(shift_id, days_before)`
where `kind = 'reminder'` makes double-texting structurally impossible. Overlapping sweeps and
mid-flight deploys hit a constraint violation and skip. Idempotency enforced by Postgres, not
by careful code.

**Naming trap, avoided deliberately:** the admin join table is `group_admins`, not
`memberships`. With participants called Members, "membership" would be ambiguous between
"a person on a rota" and "an admin's access to a group". The word *member* only ever means
"a person who takes turns".

### Regeneration rules

- **Roster change** (add / remove / reorder members): future shifts regenerate, but any shift
  that already has a cover is **preserved**. Alice's arrangement with Bob survives you adding
  Dave.
- **Schedule change** (`starts_on` or `interval_*`): the dates themselves move, so previously
  generated shifts no longer exist in the new series. Future shifts fully regenerate and covers
  are **dropped**, with an explicit warning in the admin UI before confirming.

## The engine

### Shift generation

`ShiftGenerator` takes a rota and ensures rows exist from `starts_on` out to 90 days ahead.

- Date *i* in the series: `starts_on + (i * interval_count).send(interval_unit)`.
  ActiveSupport's month arithmetic handles the edge case: `31.jan + 1.month` → 28 Feb.
- Assignee for date *i*: `positions[i % positions.count]`. The wrap-around is the rotation.
- **Inserts missing rows only** — `ON CONFLICT (rota_id, due_on) DO NOTHING`. It never updates
  an existing row. This is what actually enforces the immutable-history guarantee: an upsert
  would happily rewrite last month's assignee and quietly destroy the record of who really
  cleaned. Generation adds; only regeneration deletes, and only ever in the future.
- A rota whose `starts_on` is in the past backfills history rows. Those never trigger reminders,
  because the staleness guard buries anything more than 24 hours overdue.

A daily recurring job tops every active rota's window back up to 90 days. The same service runs
synchronously when a rota is created or edited.

A rota with **zero `rota_positions` is in draft**: `positions.count` is 0, there is no one to
assign, and generation is a no-op. Draft is derived from the roster, not a stored column —
there is no way for the flag and the roster to disagree.

### The reminder sweep is a reconciliation loop, not a trigger

The naive design fires *at* `send_hour` and texts whoever is due. It silently drops reminders
whenever the worker is down at the wrong minute, whenever a deploy lands on the hour, and every
spring when the clocks skip an hour entirely.

Instead the sweep runs hourly and asks a declarative question: **"what reminders should have
gone out by now, and haven't?"** For each active rota it computes every shift's scheduled send
moment — `due_on − days_before`, at `send_hour` in the group's timezone — and selects those now
in the past with no matching `sms_messages` row.

This is self-healing: an outage means late texts, not lost ones. It is indifferent to DST,
because the unique index makes a repeated hour a no-op.

**Staleness guard:** it will not send a reminder whose moment passed more than 24 hours ago.
Without this, adding a 7-day reminder to a rota whose next shift is Tuesday would immediately
fire a "7 days to go!" text about a shift two days away. Short outages heal; stale reminders
stay buried.

### Sending

The sweep does not call Twilio. It inserts a `pending` `sms_messages` row — *claiming* that
reminder via the unique index, which is what makes concurrent sweeps safe — and enqueues a
`SendSmsJob`. The job renders the template, sends via Twilio, records the SID.

Solid Queue provides retries with backoff, so an API blip becomes a retried job rather than a
missed chore. A signature-validated Twilio status webhook updates the row to `delivered` or
`failed`, so "I never got the text" is answerable with a carrier status rather than a shrug.

### Message templates

Free text with placeholders: `{{name}}`, `{{rota}}`, `{{date}}`, `{{days_until}}`. Unknown
placeholders are rejected at validation. The member's magic link is always appended.

```
Template:  "Hi {{name}}! It's your turn for {{rota}} on {{date}} ({{days_until}}). Thanks 💛"
Renders:   "Hi Alice! It's your turn for Kitchen deep clean on Sat 5 Jul (in 3 days). Thanks 💛
            Manage: <APP_URL>/s/x7Kd2p"
```

### The cover flow

Alice opens her magic link, sees her upcoming shifts across all rotas, picks one, picks Bob.
Rails validates that she is currently responsible, that Bob is an active, non-opted-out member
of the same group, that Bob is not Alice, and that the shift is still in the future. It sets
`covering_member_id` and texts Bob a `cover_notice` containing his own magic link.

Two rules govern who may act on a shift:

1. **Whoever is currently responsible can hand it on.** Bob, having taken Alice's shift, can
   pass it to Cara if his plans change.
2. **The original assignee can always take it back.** The escape hatch for "actually, I'm
   around after all."

Anyone affected gets a text.

Because reminders resolve `covering_member_id || assigned_member_id` at *send* time rather than
at *schedule* time, a handover needs no special reminder logic. If the 7-day text already went
to Alice and she then hands the shift to Bob, Bob gets an immediate cover notice and every
remaining reminder — the 3-day, the day-of — goes to him automatically. Nothing to reschedule,
nothing to cancel.

## Surfaces

**Admin (Next.js + shadcn, behind AuthKit)**

- Group settings: name and timezone. Small screen, load-bearing: the timezone is a *guess* until a
  human confirms it, and every reminder time in the system depends on it.
- Dashboard: who's up this week across every rota.
- Members: table; add, edit, deactivate, rotate magic link.
- Rota editor: name; schedule (`starts_on` + every N days/weeks/months); send hour; reminder
  offsets as a chip list; message template with a **live preview** rendered against a real
  member; drag-to-reorder roster.
- Upcoming shifts: covers visible; admin can override directly.
- **SMS log with delivery status.** Unglamorous, but it is the screen that answers "why didn't
  Alice get her text". Without it you are guessing.

**Member (Next.js page at `/s/[token]`, no login; Rails API at `/api/member/*` via bearer token)**

- Upcoming shifts across all rotas.
- Per shift: *"Can't make it? Ask someone to cover."* → pick a member → confirm.
- Current cover state shown, and cancellable.

Three taps from an SMS. That is the entire surface.

## Failure modes

- **Bad phone numbers** are the top cause of a silently missed reminder. Numbers are normalised
  to E.164 and validated with libphonenumber at entry — rejected at the form, not discovered
  three weeks later when nobody cleaned the kitchen.
- **A rota with no members** cannot generate shifts, so it is in **draft** until it has at least
  one position (a state derived from the roster, never stored). The admin UI says so plainly,
  rather than letting the rota look healthy while quietly generating nothing.
- **Removing a member** who holds future shifts triggers regeneration and reassignment, with an
  admin warning naming exactly what will change — including any covers they had agreed to take.
- **Twilio failures** are retried with backoff by Solid Queue. Terminal failures record the
  carrier error code and surface on the dashboard as a warning; a silently failed text is worse
  than no rota at all.
- **Magic-link enumeration** is blocked by 32-byte URL-safe tokens plus Rack::Attack rate
  limiting on the `/api/member/*` routes.
- **Token leakage into logs** is prevented by keeping the token out of every Rails path segment
  (see "The member auth path is a deliberate exception"), and by `log_arguments = false` on
  ActiveJob. Both matter because the token never expires.
- **Secrets baked into a Docker image**: the repo root holds the single `.env`, and a monorepo
  build with a root context plus `COPY . .` would copy it into a layer. A root `.dockerignore`
  excludes it. Note that BuildKit reads `.dockerignore` from the *build context root*, not from
  beside the Dockerfile — so `apps/api/.dockerignore` alone does not protect it.
- **`APP_URL` is baked into every magic link we send.** Texts are permanent in a way deploys are
  not — a link pointing at a dead host cannot be recalled. Links are always built from config,
  never hardcoded, and no real SMS is sent to a real phone until the host is settled. Local
  development uses a Twilio test credential that logs the message body instead of delivering it.

## Testing

In priority order:

1. **Tenancy isolation.** A JWT scoped to group A cannot read or write group B, asserted at the
   request-spec level. A security test, not a feature test — and the one that matters most if
   this opens up to strangers.
2. **Shift generation date math.** Month-end wraparound (31 Jan → 28 Feb), interval boundaries,
   roster wrap, and regeneration preserving covers on roster change while dropping them on
   schedule change.
3. **The reminder sweep**, driven with `travel_to`: heals a missed hour; refuses a reminder
   stale by more than 24h; sends to the cover rather than the assignee after a handover; skips
   opted-out and inactive members; run twice concurrently, produces exactly one message row.
4. **Twilio** stubbed with WebMock, plus webhook signature validation.
5. **One Playwright happy path**: admin creates a rota → member opens their magic link →
   assigns a cover → cover notice fires.

Seed data creates a demo group so the app is clickable from minute one.

**CI runs Brakeman (SAST) and bundler-audit (CVEs) on every PR**, not merely as configured
binstubs. This system grows JWT verification, tenancy scoping, a Twilio webhook and a permanent
bearer credential — none of which should reach `main` without a security gate having actually
executed.

## Open decisions

- **Hosting.** Render vs Railway, to be settled once the system works locally. Rails + Postgres
  + a Solid Queue worker; Next.js alongside or on Vercel.
- **SMS compliance at scale.** If this opens to strangers: STOP/HELP handling, A2P 10DLC sender
  registration, and who pays for messages. Not built now. The `sms_opted_out_at` column is the
  cheap insurance that makes an inbound-STOP webhook a small feature later rather than a
  migration and a backfill.
