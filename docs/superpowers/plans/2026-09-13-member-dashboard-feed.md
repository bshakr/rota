# Member dashboard feed (BLO-1666) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the member magic-link page's private shift list with a whole-house chronological feed that shows every housemate, filters by person and rota, and ranks cover candidates when handing a shift off.

**Architecture:** One new additive read endpoint, `GET /api/member/schedule`, returns the group's `today`, its timezone, every active member, every active non-draft rota, and every upcoming shift of those rotas, each shift serialised through the member path's existing `serialize_shift`. The web page stays a Server Component that holds the token and binds the two existing cover Server Actions; all new view logic lives in two pure, unit-tested modules (`schedule-view.ts`, `cover-ranking.ts`) that the client components render from.

**Tech Stack:** Rails 8 API (RSpec, FactoryBot, hand-written serializers), Next.js 16 App Router with React 19 Server Components and Server Actions, Tailwind v4 with the Soft Clay token layer, shadcn/radix primitives, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-13-member-dashboard-feed-design.md` — authoritative. Read it alongside this plan.

**Ticket:** https://linear.app/bloombase/issue/BLO-1666/member-dashboard-whole-rota-feed-people-strip-and-ranked-hand-off

---

## Global Constraints

Set `ROTA_REPO_ROOT` to the absolute path of your parent checkout before running
the shell snippets below. This keeps the plan independent of the local folder name.

- **Branch and worktree.** All work happens in `${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed` on branch `BLO-1666-member-dashboard-feed`. Never write to the parent checkout.
- **The token never reaches the client.** It is read in `page.tsx` via `await params`, passed only to the `server-only` client in `apps/web/src/lib/api/member.ts`, and forwarded only as `Authorization: Bearer <token>`. Never a path segment, never a query param, never a plain prop on a Client Component.
- **Dates are civil dates.** `due_on` and `today` are `YYYY-MM-DD` strings. All arithmetic goes through `apps/web/src/lib/group-dates.ts` (`addCivilDays`, `compareCivil`, `civilDate`). All rendering goes through `apps/web/src/lib/date.ts`. Never `new Date()` in a component, never `toLocaleDateString`.
- **"Today" is `group.today`** on the API side (never `Date.current`, never UTC) and the API's `today` field on the web side (never the browser clock, never the `TIME_ZONE` module constant).
- **No new colours.** Use only the tokens listed in "Design tokens" below.
- **Copy rules.** No em dashes anywhere in user-facing copy. The voice is warm and blameless (see `apps/web/src/components/member/invalid-link.tsx`).
- **Hit targets on phone are at least 44px** (`size="lg"` on `Button` is `h-11`; `size="icon-lg"` is `size-11`).
- **Numbers render at source precision.** Nothing in this feature rounds.
- **Feature flags: none.** The new page replaces the old one on merge.
- **Do not merge.** Open the PR, get CI green, attach the screenshot gallery, and hand over.

### Design tokens (verified in `apps/web/src/app/globals.css`)

| Meaning | Paint variable | Semantic variable | Tailwind utility |
| --- | --- | --- | --- |
| Lemon "now" tint | `--lemon-300` | `--warning` | `bg-lemon`, `text-lemon`, `bg-warning`, `<Badge variant="warning">` |
| Primary Grape | `--grape-500` | `--primary` | `bg-primary`, `text-primary`, `bg-grape` |
| Grape pressed / focus ring | `--grape-600` | `--ring` | `outline-ring`, `bg-grape-deep` |
| Plum ink on a sticker | `--plum-800` | — | `text-plum` |
| Muted plum ink | `--plum-400` | — | `text-plum-muted` |
| Avatar tint family | `--mint-300`, `--peach-300`, `--lemon-300`, `--sky-300`, `--blush-300`, `--lilac-200` | — | `bg-mint/25`, `bg-peach/25`, `bg-lemon/25`, `bg-sky/25`, `bg-blush/25`, `bg-lilac/25` |

The avatar tint is **already implemented**: `avatarTint(name)` in `apps/web/src/lib/avatar-tint.ts` returns one of those six wash classes, stable per name. Initials come from `initials(name)` in `apps/web/src/lib/format.ts`. Both are used today by `apps/web/src/app/(admin)/dashboard/_components/week-glance.tsx`. Reuse them; do not write new ones.

The "relative day" badge convention also comes from `week-glance.tsx`: `relativeDay(date, today)` from `@/lib/date`, capitalised with `capitalise()` from `@/lib/format`, shown as `<Badge variant="warning">` when it reads "today" or "tomorrow".

---

## How to run the apps locally (verified in the repo)

There is **one** `.env`, at the repo root. Both apps read it (`apps/api/config/application.rb` points dotenv there; `apps/web/next.config.ts` calls `loadEnvConfig(repoRoot, …)`).

```bash
# From the worktree root, once:
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
cp .env.example .env           # if the worktree has no .env yet
# The two values that matter for this ticket are already correct in the template:
#   APP_URL=http://localhost:3001
#   API_URL=http://localhost:3000
```

```bash
# Terminal 1 — Rails API on port 3000 (bin/rails server's default).
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bin/rails db:prepare      # creates + migrates + seeds the development DB
bin/rails server

# Terminal 2 — Next.js on port 3001 (pinned in apps/web/package.json: `next dev -p 3001`).
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm install               # only if node_modules is missing
npm run dev
```

**Seeding and getting a member magic-link token.** `apps/api/db/seeds.rb` creates the demo house "Flat 4, Alma Road" with four members (Ciara, Bass, Eliza, Raph) and two rotas ("Kitchen deep clean" weekly, "Bins out" fortnightly, roster Bass + Eliza only). It is idempotent and never rotates a token. Its last line prints each member's magic-link path:

```bash
cd apps/api && bin/rails db:seed
# Seeded Flat 4, Alma Road: 4 members, 2 rotas.
#   Ciara  +447400123001  /s/<access_token>
#   ...
```

The token is the `members.access_token` column. You can also read one directly:

```bash
cd apps/api && bin/rails runner 'puts Member.order(:name).map { |m| "#{m.name}: http://localhost:3001/s/#{m.access_token}" }'
```

**The seeds create no shifts** (by design: shifts are generated by `ShiftGenerator`, not invented in the seed file). Generate the 90-day window for every active rota before doing any QA:

```bash
cd apps/api && bin/rails runner 'TopUpShiftWindowsJob.perform_now'
```

**Rate limiting is already handled.** `apps/api/config/initializers/rack_attack.rb` throttles by the path prefix `/api/member/`, so the new `/api/member/schedule` route is covered with no config change. During a long QA session you may hit the 60-requests-per-minute per-member limit; wait a minute rather than editing the initializer.

### The commands every task runs

```bash
# API
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bundle exec rspec spec/requests/api/member/schedule_spec.rb
bin/ci                                    # the full gate: db:test:prepare, rubocop, bundler-audit, brakeman, rspec

# Web
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run                            # all unit tests
npx vitest run src/app/\(member\)/s/\[token\]/schedule-view.test.ts   # one file
npm run typecheck
npm run lint
npm run ci                                # lint + typecheck + test + token parity + build + bundle-token grep
```

---

## The JSON contract (restated for Group A and Group B)

Groups A and B are implemented independently and must agree from this block alone. Neither may change it without changing the other.

`GET /api/member/schedule`, `Authorization: Bearer <member access_token>`, 200:

```json
{
  "today": "2026-09-13",
  "timezone": "Europe/London",
  "member": { "id": 3, "name": "Bass" },
  "members": [
    { "id": 2, "name": "Bass", "contactable": true },
    { "id": 4, "name": "Ciara", "contactable": false }
  ],
  "rotas": [
    { "id": 7, "name": "Bins out" },
    { "id": 6, "name": "Kitchen deep clean" }
  ],
  "shifts": [
    {
      "id": 101,
      "rota_id": 6,
      "rota_name": "Kitchen deep clean",
      "due_on": "2026-09-19",
      "covered": false,
      "assigned_member": { "id": 3, "name": "Bass" },
      "covering_member": null,
      "responsible_member": { "id": 3, "name": "Bass" },
      "can_assign_cover": true,
      "can_cancel_cover": false
    }
  ]
}
```

Field rules:

- `today` — `group.today` as `YYYY-MM-DD` (the group's calendar date, never UTC).
- `timezone` — the group's IANA `timezone` string.
- `member` — the calling member, `{ id, name }` only.
- `members` — **every active member of the group, including the viewer**, ordered by name ascending. `contactable` mirrors `Member#contactable?` (active and not opted out). Inactive members are excluded entirely.
- `rotas` — the group's **active, non-draft** rotas, `{ id, name }`, ordered by name ascending. A draft rota is one with an empty roster (`Rota#draft?`, derived, never stored).
- `shifts` — every shift of those rotas with `due_on >= today`, ordered by `due_on` ascending then rota name ascending then shift id. Each shift is exactly the existing `MemberShift` shape already produced by `Api::MemberBaseController#serialize_shift`; `can_assign_cover` and `can_cancel_cover` are resolved for the **calling** member. No window parameter.
- Errors: 401 `{"error":"unauthorized"}` for a missing, unknown, malformed or deactivated token. 429 `{"error":"too_many_requests"}` from Rack::Attack.

Unchanged: `GET /api/member/shifts` stays exactly as it is. `POST` and `DELETE /api/member/shifts/:id/cover` remain the only writes.

---

## File structure

**API (Group A)**

| File | Responsibility |
| --- | --- |
| Create `apps/api/app/controllers/api/member_schedules_controller.rb` | The one new read action. Flat under `Api`, like its two siblings, so `Member` still resolves to the model. |
| Modify `apps/api/config/routes.rb` | One line in the member block. |
| Create `apps/api/spec/requests/api/member/schedule_spec.rb` | The request spec, written first. |

**Web pure logic (Group B)**

| File | Responsibility |
| --- | --- |
| Modify `apps/web/src/lib/api/types.ts` | `ScheduleMember`, `RotaRef`, `MemberScheduleResponse`. |
| Modify `apps/web/src/lib/api/member.ts` | `getMemberSchedule(token)`. |
| Modify `apps/web/src/lib/api/member.test.ts` | Header-not-URL assertion for the new call. |
| Create `apps/web/src/app/(member)/s/[token]/schedule-view.ts` | Week bucketing, week labels, filters, the viewer's own shifts, per-person next shift. |
| Create `apps/web/src/app/(member)/s/[token]/schedule-view.test.ts` | Its Vitest suite. |
| Create `apps/web/src/app/(member)/s/[token]/cover-ranking.ts` | `rankCoverCandidates`. |
| Create `apps/web/src/app/(member)/s/[token]/cover-ranking.test.ts` | Its Vitest suite. |
| Modify `apps/web/src/app/(member)/s/[token]/shift-view.ts` | Absorb the `ShiftState` type (its old home, `shift-card.tsx`, is deleted) and drop `coverTargetsFor`. |
| Modify `apps/web/src/app/(member)/s/[token]/shift-view.test.ts` | Delete the `coverTargetsFor` describe block. |

**Web UI (Group C)**

| File | Responsibility |
| --- | --- |
| Create `apps/web/src/hooks/use-is-desktop.ts` | SSR-safe `matchMedia("(min-width: 1024px)")` subscription. |
| Create `apps/web/src/app/(member)/s/[token]/use-shift-updates.ts` | The shared "apply the server's authoritative shift" reducer, lifted out of `shift-list.tsx`. |
| Create `apps/web/src/components/member/next-shift-card.tsx` | The lead card and its "Then …" note. |
| Create `apps/web/src/components/member/people-strip.tsx` | The horizontally scrollable avatar row (phone). |
| Create `apps/web/src/components/member/people-card.tsx` | The desktop sidebar "People" list. |
| Create `apps/web/src/components/member/filter-chips.tsx` | Everyone / Just me / one chip per rota. |
| Create `apps/web/src/components/member/shift-row.tsx` | One shift line inside a day. |
| Create `apps/web/src/components/member/week-section.tsx` | One week heading plus its day rows. |
| Create `apps/web/src/components/member/hand-off-sheet.tsx` | Sheet on phone, Dialog on desktop, ranked candidates. |
| Create `apps/web/src/app/(member)/s/[token]/member-feed.tsx` | The client shell: filter state, sheet state, responsive layout. |
| Modify `apps/web/src/components/container.tsx` | Add the `feed` width. |
| Modify `apps/web/src/app/(member)/layout.tsx` | Use `width="feed"`. |

**Integration (Group D)**

| File | Responsibility |
| --- | --- |
| Modify `apps/web/src/app/(member)/s/[token]/page.tsx` | Fetch the schedule, bind the actions, render `MemberFeed`. |
| Modify `apps/web/src/app/(member)/s/[token]/page.token-safety.test.ts` | Point at the new client tree. |
| Modify `apps/web/src/app/(member)/s/[token]/loading.tsx` | Skeleton matching the new shape. |
| Delete `apps/web/src/app/(member)/s/[token]/shift-list.tsx` | Replaced by `member-feed.tsx`. |
| Delete `apps/web/src/components/member/shift-card.tsx` | Replaced by `next-shift-card.tsx` and `shift-row.tsx`. |

---

## Dependency order

```
Group A (API)   ─┐
Group B (logic) ─┼─> Group C (UI) ─> Group D (integration) ─> Group E (QA + evidence)
                 │                        ^
                 └────────────────────────┘   (D also needs A)
```

A and B run in parallel from the start. C starts when B lands. D needs A, B and C. E needs D.

---

# Group A: the API endpoint

One task. Self-contained: it touches only `apps/api`, and nothing in Groups B–D imports from it.

### Task A1: `GET /api/member/schedule`

**Files:**
- Create: `apps/api/spec/requests/api/member/schedule_spec.rb`
- Create: `apps/api/app/controllers/api/member_schedules_controller.rb`
- Modify: `apps/api/config/routes.rb` (the member magic-link block near the end of the `namespace :api` block)

**Interfaces:**
- Consumes: `Api::MemberBaseController#serialize_shift(shift, today:)` and `#member_ref(member)` — both already exist and are `private` on the base class. `MemberAuthenticatable#current_member`. `Group#today`, `Member#contactable?`, `Rota#draft?`, `Shift.upcoming(as_of)`.
- Produces: the JSON contract above, consumed by Group B's `getMemberSchedule`.

**Read first:** `apps/api/app/controllers/api/member_base_controller.rb` (the comment at the top explains why the controllers are flat under `Api` rather than nested in an `Api::Member` module — keep it that way), `apps/api/app/controllers/api/member_shifts_controller.rb`, `apps/api/spec/requests/api/member/shifts_spec.rb`.

- [ ] **Step 1: Write the failing request spec**

Create `apps/api/spec/requests/api/member/schedule_spec.rb`:

```ruby
require "rails_helper"

# GET /api/member/schedule — the whole upcoming rota for this member's HOUSE, not just their own
# turns. It is the member page's only read. Everything here is one guarantee: a token sees its own
# group's people, rotas and upcoming shifts, and nothing of any other group's.
RSpec.describe "GET /api/member/schedule" do
  let(:group) { create(:group, timezone: "Europe/London") }
  let(:alice) { create(:member, group: group, name: "Alice") }
  let(:bob) { create(:member, group: group, name: "Bob") }
  let(:kitchen) { create(:rota, :with_roster, group: group, name: "Kitchen") }

  def get_schedule(member = alice)
    get "/api/member/schedule", headers: member_headers(member)
  end

  def parsed_shift(id)
    response.parsed_body["shifts"].find { |shift| shift["id"] == id }
  end

  describe "the group's calendar" do
    it "returns the group's own today and timezone, never UTC" do
      # 00:30 UTC on 2 March is still 1 March in New York: a UTC "today" would be a day ahead.
      group.update!(timezone: "America/New_York")
      travel_to Time.utc(2026, 3, 2, 0, 30) do
        get_schedule

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["today"]).to eq("2026-03-01")
        expect(response.parsed_body["timezone"]).to eq("America/New_York")
      end
    end

    it "names the calling member" do
      get_schedule

      expect(response.parsed_body["member"]).to eq("id" => alice.id, "name" => "Alice")
    end
  end

  describe "the people" do
    it "lists every active member of the group including the viewer, ordered by name" do
      create(:member, group: group, name: "Cara")
      create(:member, group: group, name: "Bob")

      get_schedule

      expect(response.parsed_body["members"].map { |m| m["name"] }).to eq(%w[Alice Bob Cara])
    end

    it "marks an opted-out member as not contactable, but still lists them" do
      create(:member, :opted_out, group: group, name: "Quiet")

      get_schedule

      quiet = response.parsed_body["members"].find { |m| m["name"] == "Quiet" }
      expect(quiet).to eq("id" => Member.find_by(name: "Quiet").id, "name" => "Quiet",
        "contactable" => false)
      expect(response.parsed_body["members"].find { |m| m["name"] == "Alice" }["contactable"]).to be(true)
    end

    it "excludes a deactivated member — they are no longer part of the house" do
      create(:member, :inactive, group: group, name: "Gone")

      get_schedule

      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Gone")
    end

    it "never lists a member of another group" do
      create(:member, group: create(:group), name: "Stranger")

      get_schedule

      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Stranger")
    end
  end

  describe "the rotas" do
    it "lists the group's active, rostered rotas ordered by name" do
      create(:rota, :with_roster, group: group, name: "Bins")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Bins Kitchen])
      expect(response.parsed_body["rotas"].first.keys).to contain_exactly("id", "name")
    end

    it "excludes a draft rota — an empty roster means nothing is scheduled yet" do
      create(:rota, group: group, name: "Draft")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Kitchen])
    end

    it "excludes an inactive rota" do
      create(:rota, :with_roster, :inactive, group: group, name: "Paused")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Kitchen])
    end

    it "never lists another group's rota" do
      create(:rota, :with_roster, group: create(:group), name: "Someone else's bins")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Kitchen])
    end
  end

  describe "the shifts" do
    it "returns every housemate's upcoming shift, not just the viewer's" do
      mine = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)
      theirs = create(:shift, rota: kitchen, assigned_member: bob, due_on: 4.days.from_now.to_date)

      get_schedule

      ids = response.parsed_body["shifts"].map { |shift| shift["id"] }
      expect(ids).to include(mine.id, theirs.id)
    end

    it "includes today's shift and excludes yesterday's" do
      today = create(:shift, rota: kitchen, assigned_member: bob, due_on: group.today)
      create(:shift, :past, rota: kitchen, assigned_member: bob)

      get_schedule

      expect(response.parsed_body["shifts"].map { |s| s["id"] }).to eq([ today.id ])
    end

    it "orders by due date, then rota name" do
      bins = create(:rota, :with_roster, group: group, name: "Bins")
      same_day_kitchen = create(:shift, rota: kitchen, assigned_member: alice,
        due_on: 5.days.from_now.to_date)
      same_day_bins = create(:shift, rota: bins, assigned_member: bob, due_on: 5.days.from_now.to_date)
      earlier = create(:shift, rota: kitchen, assigned_member: bob, due_on: 2.days.from_now.to_date)

      get_schedule

      expect(response.parsed_body["shifts"].map { |s| s["id"] })
        .to eq([ earlier.id, same_day_bins.id, same_day_kitchen.id ])
    end

    it "excludes the shifts of a draft or inactive rota" do
      paused = create(:rota, :with_roster, :inactive, group: group, name: "Paused")
      create(:shift, rota: paused, assigned_member: bob, due_on: 3.days.from_now.to_date)

      get_schedule

      expect(response.parsed_body["shifts"]).to be_empty
    end

    it "carries the full member-shift shape, with the rota named inline" do
      shift = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)

      get_schedule

      expect(parsed_shift(shift.id)).to eq(
        "id" => shift.id,
        "rota_id" => kitchen.id,
        "rota_name" => "Kitchen",
        "due_on" => shift.due_on.iso8601,
        "covered" => false,
        "assigned_member" => { "id" => alice.id, "name" => "Alice" },
        "covering_member" => nil,
        "responsible_member" => { "id" => alice.id, "name" => "Alice" },
        "can_assign_cover" => true,
        "can_cancel_cover" => false
      )
    end

    it "resolves the cover flags for the CALLER, not for whoever is on the shift" do
      handed_off = create(:shift, rota: kitchen, assigned_member: alice, covering_member: bob,
        due_on: 6.days.from_now.to_date)

      get_schedule(alice)
      as_alice = parsed_shift(handed_off.id)
      get_schedule(bob)
      as_bob = parsed_shift(handed_off.id)

      # Alice is the original assignee of a covered shift: she can take it back, not hand it on again.
      expect(as_alice["can_cancel_cover"]).to be(true)
      expect(as_alice["can_assign_cover"]).to be(false)
      # Bob is currently responsible: he can hand it on, but he is not the original, so he cannot cancel.
      expect(as_bob["can_assign_cover"]).to be(true)
      expect(as_bob["can_cancel_cover"]).to be(false)
    end

    it "offers no hand-off on today's shift, which is already in motion" do
      today = create(:shift, rota: kitchen, assigned_member: alice, due_on: group.today)

      get_schedule

      expect(parsed_shift(today.id)["can_assign_cover"]).to be(false)
    end
  end

  describe "tenancy" do
    it "returns nothing of another group's house" do
      other = create(:group)
      other_rota = create(:rota, :with_roster, group: other, name: "Their kitchen")
      other_member = create(:member, group: other, name: "Stranger")
      create(:shift, rota: other_rota, assigned_member: other_member, due_on: 3.days.from_now.to_date)
      kitchen

      get_schedule

      expect(response.parsed_body["shifts"]).to be_empty
      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Stranger")
      expect(response.parsed_body["rotas"].map { |r| r["name"] }).not_to include("Their kitchen")
    end
  end

  describe "authentication" do
    it "refuses a request with no token" do
      get "/api/member/schedule"

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body).to eq("error" => "unauthorized")
    end

    it "refuses an unknown token" do
      get "/api/member/schedule", headers: { "Authorization" => "Bearer not-a-real-token" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token whose member has since been deactivated" do
      token = alice.access_token
      alice.update!(active: false)

      get "/api/member/schedule", headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bundle exec rspec spec/requests/api/member/schedule_spec.rb
```

Expected: every example fails with `ActionController::RoutingError: No route matches [GET] "/api/member/schedule"`.

- [ ] **Step 3: Add the route**

In `apps/api/config/routes.rb`, inside the `namespace :api do` block, in the member magic-link section, add the new line immediately above `get "member/shifts"`:

```ruby
    # The whole house's upcoming rota (BLO-1666). Additive: /api/member/shifts stays as it is until
    # nothing calls it. Like every member route, the token is a bearer header and never a path part.
    get    "member/schedule",         to: "member_schedules#show"
    get    "member/shifts",           to: "member_shifts#index"
    post   "member/shifts/:id/cover", to: "member_covers#create"
    delete "member/shifts/:id/cover", to: "member_covers#destroy"
```

- [ ] **Step 4: Write the controller**

Create `apps/api/app/controllers/api/member_schedules_controller.rb`:

```ruby
module Api
  # GET /api/member/schedule — the WHOLE house's upcoming rota, as one member sees it.
  #
  # The member page used to ask only "what am I down for?" (Api::MemberShiftsController). To hand a
  # shift off sensibly a member needs the rest of the picture: who else lives here, what else is on
  # this week, and who is already busy. That is one payload rather than three round trips, because
  # the page renders it as a single chronological feed and a partial answer would flicker.
  #
  # Flat under Api, like its two siblings, NOT nested in an Api::Member module — see the note at the
  # top of MemberBaseController for why that module would shadow the ::Member model.
  class MemberSchedulesController < MemberBaseController
    def show
      group = current_member.group
      today = group.today
      rotas = visible_rotas(group)

      render json: {
        today: today.iso8601,
        timezone: group.timezone,
        member: member_ref(current_member),
        members: group.members.active.order(:name).map { |member| schedule_member_ref(member) },
        rotas: rotas.map { |rota| { id: rota.id, name: rota.name } },
        shifts: upcoming_shifts(rotas, today).map { |shift| serialize_shift(shift, today: today) }
      }
    end

    private

    # Active rotas with a roster. `draft?` is DERIVED from the roster (Rota#draft?), never stored, so
    # it cannot be a WHERE clause; `includes(:rota_positions)` loads every roster in one extra query
    # and the reject runs in Ruby without an N+1.
    def visible_rotas(group)
      group.rotas.active.includes(:rota_positions).order(:name).reject(&:draft?)
    end

    # Every upcoming shift of those rotas. `preload` rather than `includes`: the join is already
    # present for the rota-name ordering, and preload keeps the association loads as separate
    # queries instead of letting Rails collapse them into an eager-load that fights the ORDER BY.
    # Shift id breaks a tie between two shifts of the same rota on the same day, which the
    # (rota_id, due_on) uniqueness makes impossible today but which keeps the order total anyway.
    def upcoming_shifts(rotas, today)
      Shift.joins(:rota)
        .where(rota_id: rotas.map(&:id))
        .upcoming(today)
        .preload(:rota, :assigned_member, :covering_member)
        .order(:due_on, "rotas.name", :id)
    end

    # `contactable` folds "active and not opted out" into the one boolean the page acts on: an
    # opted-out housemate is still shown (they live here) but cannot be handed a shift, because the
    # cover action would reject them.
    def schedule_member_ref(member)
      member_ref(member).merge(contactable: member.contactable?)
    end
  end
end
```

- [ ] **Step 5: Run the spec to verify it passes**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bundle exec rspec spec/requests/api/member/schedule_spec.rb
```

Expected: all examples PASS.

- [ ] **Step 6: Run the whole API gate**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bin/ci
```

Expected: Setup, Style: Ruby (rubocop), Security: Gem audit, Security: Brakeman, Tests: Ruby all green. Fix any rubocop offence in the new files rather than adding an exclusion.

- [ ] **Step 7: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/api/app/controllers/api/member_schedules_controller.rb \
        apps/api/config/routes.rb \
        apps/api/spec/requests/api/member/schedule_spec.rb
git commit -m "BLO-1666: GET /api/member/schedule — the whole house's upcoming rota

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

**Definition of done for Group A:** `/api/member/schedule` returns the contract above; `bundle exec rspec spec/requests/api/member/schedule_spec.rb` is green; `bin/ci` is green; `spec/requests/api/member/shifts_spec.rb` and `covers_spec.rb` still pass untouched.

---

# Group B: the web types, client and pure view logic

Four tasks. No JSX, no React. Everything here is a pure function with a Vitest suite, running in the node environment configured by `apps/web/vitest.config.ts`.

### Task B1: types and the `getMemberSchedule` client

**Files:**
- Modify: `apps/web/src/lib/api/types.ts` (append to the "Member magic-link path" section at the end)
- Modify: `apps/web/src/lib/api/member.ts`
- Modify: `apps/web/src/lib/api/member.test.ts`

**Interfaces:**
- Consumes: `requestJson<T>(path, token, init?)` from `@/lib/api/http`; the existing `MemberRef` and `MemberShift` types.
- Produces: `ScheduleMember`, `RotaRef`, `MemberScheduleResponse`, `getMemberSchedule(token: string): Promise<MemberScheduleResponse>` — used by Tasks B2, B3, C*, D1.

- [ ] **Step 1: Write the failing client test**

In `apps/web/src/lib/api/member.test.ts`, add `getMemberSchedule` to the import at the top:

```ts
import { assignCover, cancelCover, getMemberSchedule, getMemberShifts } from "./member";
```

and add this example inside the existing `describe("member API client", …)` block, directly after the `getMemberShifts` example:

```ts
  it("fetches the whole-house schedule with the token in the header and not the URL", async () => {
    await getMemberSchedule(TOKEN);
    const { url, headers } = lastFetchCall();

    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).toBe("http://rails.test/api/member/schedule");
    expect(url).not.toContain(TOKEN);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run src/lib/api/member.test.ts
```

Expected: FAIL — `getMemberSchedule is not a function` (or a TypeScript resolution error).

- [ ] **Step 3: Add the types**

Append to the end of `apps/web/src/lib/api/types.ts`:

```ts
/**
 * A housemate as the member page sees them. `contactable` folds "active and not
 * opted out" into the one boolean the UI acts on: an opted-out housemate still
 * appears in the people strip (they live here) but cannot be handed a shift,
 * because the cover action would reject them.
 */
export interface ScheduleMember extends MemberRef {
  contactable: boolean;
}

/** A rota reduced to what a filter chip needs. */
export interface RotaRef {
  id: number;
  name: string;
}

/**
 * GET /api/member/schedule — the whole house's upcoming rota in one payload.
 *
 * `today` is the GROUP's calendar date, not the browser's and not the server's:
 * every week boundary and every "in 3 days" on this page is measured from it.
 * `shifts` covers every active, rostered rota, not only the viewer's turns, and
 * each shift's `can_assign_cover` / `can_cancel_cover` are resolved for the
 * VIEWER, so the page shows only the buttons the API would accept.
 */
export interface MemberScheduleResponse {
  /** The group's today, as a civil date (YYYY-MM-DD). */
  today: string;
  /** The group's IANA timezone, e.g. "Europe/London". */
  timezone: string;
  member: MemberRef;
  /** Every active member of the group, including the viewer, ordered by name. */
  members: ScheduleMember[];
  /** The group's active, non-draft rotas, ordered by name. */
  rotas: RotaRef[];
  /** Every shift of those rotas with due_on >= today, by due date then rota name. */
  shifts: MemberShift[];
}
```

- [ ] **Step 4: Add the client function**

In `apps/web/src/lib/api/member.ts`, extend the type import and add the function above `getMemberShifts`:

```ts
import type { MemberCoverResponse, MemberScheduleResponse, MemberShiftsResponse } from "./types";
```

```ts
/**
 * The whole house's upcoming rota: the group's today and timezone, every active
 * housemate, every active rota, and every upcoming shift across them. One request,
 * because the page renders it as a single feed and a partial answer would flicker.
 */
export function getMemberSchedule(token: string): Promise<MemberScheduleResponse> {
  return requestJson<MemberScheduleResponse>("/api/member/schedule", token);
}
```

- [ ] **Step 5: Run the tests and the typechecker**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run src/lib/api/member.test.ts && npm run typecheck
```

Expected: PASS, and typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/web/src/lib/api/types.ts apps/web/src/lib/api/member.ts apps/web/src/lib/api/member.test.ts
git commit -m "BLO-1666: MemberScheduleResponse types and the getMemberSchedule client

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task B2: `schedule-view.ts`

**Files:**
- Create: `apps/web/src/app/(member)/s/[token]/schedule-view.ts`
- Test: `apps/web/src/app/(member)/s/[token]/schedule-view.test.ts`

**Interfaces:**
- Consumes: `MemberScheduleResponse`, `MemberShift` from `@/lib/api/types` (Task B1); `addCivilDays`, `civilDate`, `compareCivil` from `@/lib/group-dates`; `formatDayNumber`, `formatMonthShort` from `@/lib/date`.
- Produces, for Groups C and D:
  - `type RotaFilter = { kind: "everyone" } | { kind: "me" } | { kind: "rota"; rotaId: number }`
  - `interface FeedFilter { rota: RotaFilter; personId: number | null }`
  - `const ALL_SHIFTS: FeedFilter`
  - `interface DayRow { due_on: string; shifts: MemberShift[] }`
  - `interface WeekSection { weekStart: string; label: string; days: DayRow[] }`
  - `function weekStart(civil: string): string`
  - `function weekLabel(start: string, today: string): string`
  - `function shiftInvolves(shift: MemberShift, memberId: number): boolean`
  - `function matchesFilter(shift: MemberShift, filter: FeedFilter, viewerId: number): boolean`
  - `function buildFeed(schedule: MemberScheduleResponse, filter: FeedFilter): WeekSection[]`
  - `function responsibleShifts(schedule: MemberScheduleResponse, memberId?: number): MemberShift[]`
  - `function nextShiftByMember(schedule: MemberScheduleResponse): Map<number, MemberShift>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(member)/s/[token]/schedule-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";

import {
  ALL_SHIFTS,
  buildFeed,
  matchesFilter,
  nextShiftByMember,
  responsibleShifts,
  shiftInvolves,
  weekLabel,
  weekStart,
} from "./schedule-view";

// The viewer is always id 1 in these fixtures; everyone else is a housemate.
const ME = 1;

let nextId = 100;

function shift(partial: Partial<MemberShift> & { due_on: string }): MemberShift {
  const assigned = partial.assigned_member ?? { id: ME, name: "Alice" };
  const covering = partial.covering_member ?? null;
  return {
    id: nextId++,
    rota_id: 1,
    rota_name: "Kitchen",
    covered: covering !== null,
    assigned_member: assigned,
    covering_member: covering,
    responsible_member: covering ?? assigned,
    can_assign_cover: false,
    can_cancel_cover: false,
    ...partial,
  };
}

function schedule(partial: Partial<MemberScheduleResponse> = {}): MemberScheduleResponse {
  return {
    today: "2026-09-13",
    timezone: "Europe/London",
    member: { id: ME, name: "Alice" },
    members: [
      { id: ME, name: "Alice", contactable: true },
      { id: 2, name: "Bob", contactable: true },
    ],
    rotas: [{ id: 1, name: "Kitchen" }],
    shifts: [],
    ...partial,
  };
}

describe("weekStart", () => {
  it("returns the Monday of the week containing a midweek day", () => {
    // Wednesday 16 September 2026.
    expect(weekStart("2026-09-16")).toBe("2026-09-14");
  });

  it("returns the day itself for a Monday", () => {
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
  });

  it("treats Sunday as the LAST day of its week, not the first", () => {
    // Sunday 13 September 2026 belongs to the week starting Monday 7 September.
    expect(weekStart("2026-09-13")).toBe("2026-09-07");
  });

  it("crosses a year boundary" , () => {
    // Friday 1 January 2027 falls in the week starting Monday 28 December 2026.
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("weekLabel", () => {
  it("names the week containing today 'This week'", () => {
    expect(weekLabel("2026-09-14", "2026-09-16")).toBe("This week");
  });

  it("names the following week 'Next week'", () => {
    expect(weekLabel("2026-09-21", "2026-09-16")).toBe("Next week");
  });

  it("labels a later week by its range, collapsing a shared month", () => {
    // Mon 5 Oct to Sun 11 Oct 2026.
    expect(weekLabel("2026-10-05", "2026-09-16")).toBe("5–11 Oct");
  });

  it("spells both months out when a week straddles them", () => {
    // Mon 28 Sep to Sun 4 Oct 2026.
    expect(weekLabel("2026-09-28", "2026-09-16")).toBe("28 Sep – 4 Oct");
  });

  it("handles a week that straddles the new year", () => {
    // Mon 28 Dec 2026 to Sun 3 Jan 2027.
    expect(weekLabel("2026-12-28", "2026-09-16")).toBe("28 Dec – 3 Jan");
  });

  it("gives 'This week' a single day when today is a Sunday", () => {
    // Sunday 13 Sep is the last day of the week that began Mon 7 Sep, so "This week"
    // still names that week; only today and later are ever rendered into it.
    expect(weekLabel("2026-09-07", "2026-09-13")).toBe("This week");
    expect(weekLabel("2026-09-14", "2026-09-13")).toBe("Next week");
  });
});

describe("shiftInvolves", () => {
  it("is true for the assignee and for the cover, false for anyone else", () => {
    const handedOff = shift({
      due_on: "2026-09-16",
      assigned_member: { id: ME, name: "Alice" },
      covering_member: { id: 2, name: "Bob" },
    });

    expect(shiftInvolves(handedOff, ME)).toBe(true);
    expect(shiftInvolves(handedOff, 2)).toBe(true);
    expect(shiftInvolves(handedOff, 3)).toBe(false);
  });
});

describe("matchesFilter", () => {
  const mine = shift({ due_on: "2026-09-16", assigned_member: { id: ME, name: "Alice" } });
  const theirs = shift({
    due_on: "2026-09-17",
    rota_id: 2,
    rota_name: "Bins",
    assigned_member: { id: 2, name: "Bob" },
  });

  it("lets everything through under the default filter", () => {
    expect(matchesFilter(mine, ALL_SHIFTS, ME)).toBe(true);
    expect(matchesFilter(theirs, ALL_SHIFTS, ME)).toBe(true);
  });

  it("'just me' keeps only shifts the viewer is on", () => {
    const filter = { rota: { kind: "me" } as const, personId: null };
    expect(matchesFilter(mine, filter, ME)).toBe(true);
    expect(matchesFilter(theirs, filter, ME)).toBe(false);
  });

  it("a rota filter keeps only that rota", () => {
    const filter = { rota: { kind: "rota" as const, rotaId: 2 }, personId: null };
    expect(matchesFilter(mine, filter, ME)).toBe(false);
    expect(matchesFilter(theirs, filter, ME)).toBe(true);
  });

  it("combines a person filter with a rota filter", () => {
    const bobsBins = { rota: { kind: "rota" as const, rotaId: 2 }, personId: 2 };
    const alicesBins = { rota: { kind: "rota" as const, rotaId: 2 }, personId: ME };
    expect(matchesFilter(theirs, bobsBins, ME)).toBe(true);
    expect(matchesFilter(theirs, alicesBins, ME)).toBe(false);
  });

  it("a person filter matches the cover as well as the assignee", () => {
    const covered = shift({
      due_on: "2026-09-18",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: 2, name: "Bob" },
    });
    expect(matchesFilter(covered, { rota: { kind: "everyone" }, personId: 2 }, ME)).toBe(true);
  });
});

describe("buildFeed", () => {
  it("buckets shifts into weeks and days, in order", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-14",
        shifts: [
          shift({ due_on: "2026-09-16" }),
          shift({ due_on: "2026-09-16", rota_id: 2, rota_name: "Bins" }),
          shift({ due_on: "2026-09-19" }),
          shift({ due_on: "2026-09-22" }),
        ],
      }),
      ALL_SHIFTS,
    );

    expect(feed.map((week) => week.label)).toEqual(["This week", "Next week"]);
    expect(feed[0].weekStart).toBe("2026-09-14");
    expect(feed[0].days.map((day) => day.due_on)).toEqual(["2026-09-16", "2026-09-19"]);
    expect(feed[0].days[0].shifts).toHaveLength(2);
    expect(feed[1].days.map((day) => day.due_on)).toEqual(["2026-09-22"]);
  });

  it("orders same-day shifts by rota name", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-14",
        shifts: [
          shift({ due_on: "2026-09-16", rota_id: 1, rota_name: "Kitchen" }),
          shift({ due_on: "2026-09-16", rota_id: 2, rota_name: "Bins" }),
        ],
      }),
      ALL_SHIFTS,
    );

    expect(feed[0].days[0].shifts.map((s) => s.rota_name)).toEqual(["Bins", "Kitchen"]);
  });

  it("drops anything before today, whatever the API sent", () => {
    const feed = buildFeed(
      schedule({ today: "2026-09-14", shifts: [shift({ due_on: "2026-09-13" })] }),
      ALL_SHIFTS,
    );

    expect(feed).toEqual([]);
  });

  it("puts today into 'This week' even when today is a Sunday", () => {
    const feed = buildFeed(
      schedule({ today: "2026-09-13", shifts: [shift({ due_on: "2026-09-13" })] }),
      ALL_SHIFTS,
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].label).toBe("This week");
    expect(feed[0].days.map((day) => day.due_on)).toEqual(["2026-09-13"]);
  });

  it("returns no weeks when the filter matches nothing", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-14",
        shifts: [shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } })],
      }),
      { rota: { kind: "me" }, personId: null },
    );

    expect(feed).toEqual([]);
  });
});

describe("responsibleShifts", () => {
  it("returns the viewer's own turns in order, including ones they are covering", () => {
    const own = shift({ due_on: "2026-09-20" });
    const covering = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 2, name: "Bob" },
      covering_member: { id: ME, name: "Alice" },
    });
    const handedOff = shift({
      due_on: "2026-09-18",
      assigned_member: { id: ME, name: "Alice" },
      covering_member: { id: 2, name: "Bob" },
    });

    const mine = responsibleShifts(schedule({ today: "2026-09-14", shifts: [own, covering, handedOff] }));

    // A shift handed away is no longer MINE to do, so it is not in this list, even though it still
    // appears in the feed with a "Take it back".
    expect(mine.map((s) => s.id)).toEqual([covering.id, own.id]);
  });

  it("can answer for any housemate", () => {
    const bobs = shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } });
    const mine = shift({ due_on: "2026-09-17" });

    expect(
      responsibleShifts(schedule({ today: "2026-09-14", shifts: [bobs, mine] }), 2).map((s) => s.id),
    ).toEqual([bobs.id]);
  });
});

describe("nextShiftByMember", () => {
  it("maps each person to the first shift they are responsible for", () => {
    const bobFirst = shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } });
    const bobLater = shift({ due_on: "2026-09-23", assigned_member: { id: 2, name: "Bob" } });
    const mine = shift({ due_on: "2026-09-17" });

    const next = nextShiftByMember(schedule({ today: "2026-09-14", shifts: [bobLater, bobFirst, mine] }));

    expect(next.get(2)?.id).toBe(bobFirst.id);
    expect(next.get(ME)?.id).toBe(mine.id);
  });

  it("credits the cover, not the assignee, for a covered shift", () => {
    const covered = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: 2, name: "Bob" },
    });

    const next = nextShiftByMember(schedule({ today: "2026-09-14", shifts: [covered] }));

    expect(next.get(2)?.id).toBe(covered.id);
    expect(next.has(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/schedule-view.test.ts'
```

Expected: FAIL — `Failed to resolve import "./schedule-view"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/app/(member)/s/[token]/schedule-view.ts`:

```ts
import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";
import { formatDayNumber, formatMonthShort } from "@/lib/date";
import { addCivilDays, civilDate, compareCivil } from "@/lib/group-dates";

// The member feed's view model, as pure functions. Everything the page decides about
// WHICH shifts appear and HOW they are grouped lives here, alone and tested, because
// it is the only real logic on an otherwise presentational screen and because it has
// to hold after a cover mutation returns a fresh shift, not just on first load.
//
// Every date here is a CIVIL date (YYYY-MM-DD) and every comparison goes through
// group-dates.ts. The reference "today" is always the one the API sent — the GROUP's
// calendar date — never the browser clock and never the app-wide TIME_ZONE constant.
// A London house provisioned as UTC must not have its week boundary an hour out.

/** How the feed is narrowed by rota. `me` is "any shift I'm on", across every rota. */
export type RotaFilter =
  | { kind: "everyone" }
  | { kind: "me" }
  | { kind: "rota"; rotaId: number };

/**
 * The feed's whole filter state. The two halves combine with AND and clear
 * independently: tapping "Everyone" clears the rota half, tapping the selected
 * avatar clears the person half.
 */
export interface FeedFilter {
  rota: RotaFilter;
  /** A housemate the feed is narrowed to, or null for the whole house. */
  personId: number | null;
}

/** The default: the whole house, every rota. */
export const ALL_SHIFTS: FeedFilter = { rota: { kind: "everyone" }, personId: null };

/** One calendar day inside a week section, with everything due that day. */
export interface DayRow {
  due_on: string;
  shifts: MemberShift[];
}

/** One week of the feed: a Monday, a human label, and the days that have shifts. */
export interface WeekSection {
  /** The Monday of this week, as a civil date. */
  weekStart: string;
  label: string;
  days: DayRow[];
}

/**
 * The Monday of the week containing `civil`, as a civil date.
 *
 * Weeks run Monday to Sunday. `getUTCDay` is safe here because `civilDate` pins the
 * instant to NOON UTC, so the UTC weekday is the calendar weekday in every real zone.
 */
export function weekStart(civil: string): string {
  const weekday = civilDate(civil).getUTCDay(); // 0 = Sunday
  return addCivilDays(civil, -(weekday === 0 ? 6 : weekday - 1));
}

/**
 * What a week section is called. The week containing today is "This week" even when
 * today is a Sunday — in which case the section holds only today, since nothing
 * earlier is ever rendered.
 */
export function weekLabel(start: string, today: string): string {
  const current = weekStart(today);
  if (start === current) return "This week";
  if (start === addCivilDays(current, 7)) return "Next week";
  return weekRangeLabel(start);
}

// "5-11 Oct" when the week sits inside one month, "28 Sep - 4 Oct" when it straddles
// two (a new year included: "28 Dec - 3 Jan"). The dashes are en dashes, spaced only
// in the straddling form, which is how the spec writes them.
function weekRangeLabel(start: string): string {
  const from = civilDate(start);
  const to = civilDate(addCivilDays(start, 6));
  const fromMonth = formatMonthShort(from);
  const toMonth = formatMonthShort(to);

  return fromMonth === toMonth
    ? `${formatDayNumber(from)}–${formatDayNumber(to)} ${toMonth}`
    : `${formatDayNumber(from)} ${fromMonth} – ${formatDayNumber(to)} ${toMonth}`;
}

/**
 * Does this member have a stake in this shift? True for the person the rota assigned
 * it to AND for whoever is covering — deliberately broader than "responsible", because
 * someone who handed a shift away must still see it to take it back.
 */
export function shiftInvolves(shift: MemberShift, memberId: number): boolean {
  return shift.assigned_member.id === memberId || shift.covering_member?.id === memberId;
}

/** Whether one shift survives the current filter. The two halves combine with AND. */
export function matchesFilter(shift: MemberShift, filter: FeedFilter, viewerId: number): boolean {
  if (filter.rota.kind === "me" && !shiftInvolves(shift, viewerId)) return false;
  if (filter.rota.kind === "rota" && shift.rota_id !== filter.rota.rotaId) return false;
  if (filter.personId !== null && !shiftInvolves(shift, filter.personId)) return false;
  return true;
}

// One comparator for every ordering on this page: by day, then by rota name so two
// jobs due the same day always read in the same order, then by id so it is total.
function byDayThenRota(a: MemberShift, b: MemberShift): number {
  return (
    compareCivil(a.due_on, b.due_on) || a.rota_name.localeCompare(b.rota_name) || a.id - b.id
  );
}

function upcoming(schedule: MemberScheduleResponse): MemberShift[] {
  return schedule.shifts
    .filter((shift) => compareCivil(shift.due_on, schedule.today) >= 0)
    .sort(byDayThenRota);
}

/**
 * The whole feed: week sections, each holding the days that actually have shifts.
 *
 * Weeks and days with nothing in them are omitted rather than rendered empty, so a
 * fortnightly rota does not leave a blank card every other week. Past shifts are
 * dropped here as well as on the server: the function is then total, and a stale
 * payload after midnight cannot render yesterday.
 */
export function buildFeed(schedule: MemberScheduleResponse, filter: FeedFilter): WeekSection[] {
  const weeks: WeekSection[] = [];

  for (const shift of upcoming(schedule)) {
    if (!matchesFilter(shift, filter, schedule.member.id)) continue;

    const start = weekStart(shift.due_on);
    let week = weeks.at(-1);
    if (!week || week.weekStart !== start) {
      week = { weekStart: start, label: weekLabel(start, schedule.today), days: [] };
      weeks.push(week);
    }

    let day = week.days.at(-1);
    if (!day || day.due_on !== shift.due_on) {
      day = { due_on: shift.due_on, shifts: [] };
      week.days.push(day);
    }
    day.shifts.push(shift);
  }

  return weeks;
}

/**
 * The upcoming turns a person is actually on the hook for, in order. Defaults to the
 * viewer. A shift they have handed away is NOT here — it is no longer theirs to do,
 * even though the feed still shows it with a "Take it back".
 */
export function responsibleShifts(
  schedule: MemberScheduleResponse,
  memberId: number = schedule.member.id,
): MemberShift[] {
  return upcoming(schedule).filter((shift) => shift.responsible_member.id === memberId);
}

/**
 * Each housemate's next turn, keyed by member id. Keyed on who is RESPONSIBLE, so a
 * covered shift counts for the cover and not for the original assignee: "what is Bob
 * next down for" has to mean what Bob will actually do.
 */
export function nextShiftByMember(schedule: MemberScheduleResponse): Map<number, MemberShift> {
  const next = new Map<number, MemberShift>();
  for (const shift of upcoming(schedule)) {
    const id = shift.responsible_member.id;
    if (!next.has(id)) next.set(id, shift);
  }
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/schedule-view.test.ts' && npm run typecheck && npm run lint
```

Expected: all PASS, typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add 'apps/web/src/app/(member)/s/[token]/schedule-view.ts' 'apps/web/src/app/(member)/s/[token]/schedule-view.test.ts'
git commit -m "BLO-1666: schedule-view — week bucketing, labels and feed filters

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task B3: `cover-ranking.ts`

**Files:**
- Create: `apps/web/src/app/(member)/s/[token]/cover-ranking.ts`
- Test: `apps/web/src/app/(member)/s/[token]/cover-ranking.test.ts`

**Interfaces:**
- Consumes: `weekStart` from `./schedule-view` (Task B2); `MemberScheduleResponse`, `MemberShift`, `ScheduleMember` from `@/lib/api/types`.
- Produces, for Group C:
  - `interface CoverCandidate { member: ScheduleMember; weekShifts: MemberShift[]; upcomingCount: number }`
  - `interface CoverCandidates { free: CoverCandidate[]; busy: CoverCandidate[]; unavailable: CoverCandidate[] }`
  - `function rankCoverCandidates(shift: MemberShift, schedule: MemberScheduleResponse): CoverCandidates`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(member)/s/[token]/cover-ranking.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { MemberScheduleResponse, MemberShift, ScheduleMember } from "@/lib/api/types";

import { rankCoverCandidates } from "./cover-ranking";

const ME = 1;

let nextId = 500;

function person(id: number, name: string, contactable = true): ScheduleMember {
  return { id, name, contactable };
}

function shift(partial: Partial<MemberShift> & { due_on: string }): MemberShift {
  const assigned = partial.assigned_member ?? { id: ME, name: "Alice" };
  const covering = partial.covering_member ?? null;
  return {
    id: nextId++,
    rota_id: 1,
    rota_name: "Kitchen",
    covered: covering !== null,
    assigned_member: assigned,
    covering_member: covering,
    responsible_member: covering ?? assigned,
    can_assign_cover: true,
    can_cancel_cover: false,
    ...partial,
  };
}

function schedule(
  members: ScheduleMember[],
  shifts: MemberShift[],
  today = "2026-09-14",
): MemberScheduleResponse {
  return {
    today,
    timezone: "Europe/London",
    member: { id: ME, name: "Alice" },
    members,
    rotas: [{ id: 1, name: "Kitchen" }],
    shifts,
  };
}

describe("rankCoverCandidates", () => {
  it("never offers the viewer or the shift's assignee", () => {
    const mine = shift({ due_on: "2026-09-16" });
    const ranked = rankCoverCandidates(
      mine,
      schedule([person(ME, "Alice"), person(2, "Bob")], [mine]),
    );

    const named = [...ranked.free, ...ranked.busy, ...ranked.unavailable].map((c) => c.member.name);
    expect(named).toEqual(["Bob"]);
  });

  it("never offers the assignee back their own shift when the viewer is only covering", () => {
    // Alice took Cara's turn and is now handing it on. Cara must not be offered it back:
    // the API rejects that as already_assignee.
    const covered = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: ME, name: "Alice" },
    });
    const ranked = rankCoverCandidates(
      covered,
      schedule([person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")], [covered]),
    );

    const named = [...ranked.free, ...ranked.busy, ...ranked.unavailable].map((c) => c.member.name);
    expect(named).toEqual(["Bob"]);
  });

  it("splits free from busy by whether they already have a turn THAT week", () => {
    const target = shift({ due_on: "2026-09-16" }); // Wed, week of Mon 14 Sep
    const bobsSameWeek = shift({
      due_on: "2026-09-18",
      rota_id: 2,
      rota_name: "Bins",
      assigned_member: { id: 2, name: "Bob" },
    });
    const carasNextWeek = shift({ due_on: "2026-09-23", assigned_member: { id: 3, name: "Cara" } });

    const ranked = rankCoverCandidates(
      target,
      schedule(
        [person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")],
        [target, bobsSameWeek, carasNextWeek],
      ),
    );

    expect(ranked.free.map((c) => c.member.name)).toEqual(["Cara"]);
    expect(ranked.busy.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.busy[0].weekShifts.map((s) => s.rota_name)).toEqual(["Bins"]);
  });

  it("puts people who can't be texted in their own group, whatever their load", () => {
    const target = shift({ due_on: "2026-09-16" });
    const ranked = rankCoverCandidates(
      target,
      schedule([person(ME, "Alice"), person(2, "Bob", false), person(3, "Cara")], [target]),
    );

    expect(ranked.free.map((c) => c.member.name)).toEqual(["Cara"]);
    expect(ranked.unavailable.map((c) => c.member.name)).toEqual(["Bob"]);
  });

  it("orders within a group by fewest upcoming turns, then by name", () => {
    const target = shift({ due_on: "2026-09-16" });
    const busyCara = shift({ due_on: "2026-09-28", assigned_member: { id: 3, name: "Cara" } });
    const busyCaraToo = shift({ due_on: "2026-10-05", assigned_member: { id: 3, name: "Cara" } });

    const ranked = rankCoverCandidates(
      target,
      schedule(
        [person(ME, "Alice"), person(4, "Dana"), person(2, "Bob"), person(3, "Cara")],
        [target, busyCara, busyCaraToo],
      ),
    );

    // Bob and Dana both have nothing upcoming, so they sort by name; Cara has two.
    expect(ranked.free.map((c) => c.member.name)).toEqual(["Bob", "Dana", "Cara"]);
    expect(ranked.free.map((c) => c.upcomingCount)).toEqual([0, 0, 2]);
  });

  it("does not count the shift being handed off against anyone", () => {
    // Bob is covering the very shift being passed on; it must not make him look busy.
    const target = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: 2, name: "Bob" },
    });

    const ranked = rankCoverCandidates(
      target,
      schedule([person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")], [target]),
    );

    expect(ranked.free.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.free[0].upcomingCount).toBe(0);
  });

  it("returns three empty groups in a one-member house", () => {
    const target = shift({ due_on: "2026-09-16" });
    const ranked = rankCoverCandidates(target, schedule([person(ME, "Alice")], [target]));

    expect(ranked).toEqual({ free: [], busy: [], unavailable: [] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/cover-ranking.test.ts'
```

Expected: FAIL — `Failed to resolve import "./cover-ranking"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/app/(member)/s/[token]/cover-ranking.ts`:

```ts
import type { MemberScheduleResponse, MemberShift, ScheduleMember } from "@/lib/api/types";

import { weekStart } from "./schedule-view";

// Who is a reasonable ask. The old cover dialog was a flat list of names, which made
// every housemate look equally free; the whole point of fetching the rest of the rota
// is that the page can now say "Cara is free that week" and "Bob already has the bins
// on Friday" before anyone is texted.
//
// BLO-1667 (calendar sync) adds an `away` group HERE and nowhere else.

export interface CoverCandidate {
  member: ScheduleMember;
  /** What they are already down for in the week of the shift being handed off. */
  weekShifts: MemberShift[];
  /** How many upcoming turns they are responsible for in total. The tie-break. */
  upcomingCount: number;
}

/**
 * The three groups the hand-off sheet renders, in this order. `unavailable` is listed
 * but not selectable: an opted-out housemate still lives here, and hiding them reads
 * as "they don't exist" rather than "we can't text them".
 */
export interface CoverCandidates {
  free: CoverCandidate[];
  busy: CoverCandidate[];
  unavailable: CoverCandidate[];
}

/**
 * Rank everyone who could take `shift`.
 *
 * Two people are never offered: the viewer (handing a shift to yourself is the
 * `self_cover` rejection) and the shift's original assignee (the `already_assignee`
 * rejection). So the sheet can never present a name the API would refuse.
 *
 * The shift being handed off is excluded from everyone's own load — otherwise whoever
 * is currently covering it would be counted as busy with the very thing they are
 * trying to pass on.
 */
export function rankCoverCandidates(
  shift: MemberShift,
  schedule: MemberScheduleResponse,
): CoverCandidates {
  const week = weekStart(shift.due_on);
  const excluded = new Set([schedule.member.id, shift.assigned_member.id]);

  const candidates: CoverCandidate[] = schedule.members
    .filter((member) => !excluded.has(member.id))
    .map((member) => {
      const theirs = schedule.shifts.filter(
        (other) => other.id !== shift.id && other.responsible_member.id === member.id,
      );
      return {
        member,
        weekShifts: theirs
          .filter((other) => weekStart(other.due_on) === week)
          .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.rota_name.localeCompare(b.rota_name)),
        upcomingCount: theirs.length,
      };
    });

  // Fewest upcoming turns first, because "who has the least on" is the fair ask; name
  // breaks the tie so the order is stable between renders.
  const byLoadThenName = (a: CoverCandidate, b: CoverCandidate) =>
    a.upcomingCount - b.upcomingCount || a.member.name.localeCompare(b.member.name);

  return {
    free: candidates
      .filter((c) => c.member.contactable && c.weekShifts.length === 0)
      .sort(byLoadThenName),
    busy: candidates
      .filter((c) => c.member.contactable && c.weekShifts.length > 0)
      .sort(byLoadThenName),
    unavailable: candidates.filter((c) => !c.member.contactable).sort(byLoadThenName),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/cover-ranking.test.ts' && npm run typecheck && npm run lint
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add 'apps/web/src/app/(member)/s/[token]/cover-ranking.ts' 'apps/web/src/app/(member)/s/[token]/cover-ranking.test.ts'
git commit -m "BLO-1666: cover-ranking — free / has a shift that week / can't be texted

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task B4: rehome `ShiftState` and drop `coverTargetsFor`

`shift-view.ts` currently imports its `ShiftState` type from `@/components/member/shift-card`, which Group D deletes. `coverTargetsFor` is superseded by `rankCoverCandidates`.

**Files:**
- Modify: `apps/web/src/app/(member)/s/[token]/shift-view.ts`
- Modify: `apps/web/src/app/(member)/s/[token]/shift-view.test.ts`

**Interfaces:**
- Produces: `type ShiftState` and `function shiftStateFor(shift, memberId): ShiftState | null`, now both exported from `shift-view.ts`. Group C's `next-shift-card.tsx` and `shift-row.tsx` import them from there.

- [ ] **Step 1: Delete the superseded test block**

In `apps/web/src/app/(member)/s/[token]/shift-view.test.ts`, delete the entire `describe("coverTargetsFor", () => { … });` block (it begins at line 64 today) and remove `coverTargetsFor` from the import at the top, leaving:

```ts
import { shiftStateFor } from "./shift-view";
```

Also delete the now-unused `MemberRef` import if nothing else in the file uses it (the `ref` helper still does; keep it if so).

- [ ] **Step 2: Run the test to see it fail on the import**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/shift-view.test.ts'
```

Expected: PASS (deleting a test never fails), but `npm run typecheck` is still green at this point too. This step exists to keep the suite honest before the source edit.

- [ ] **Step 3: Rewrite `shift-view.ts`**

Replace the whole of `apps/web/src/app/(member)/s/[token]/shift-view.ts` with:

```ts
import type { MemberShift } from "@/lib/api/types";

// The one pure decision the member page makes about a shift: what is this to ME?
// It lived alongside the old shift card; the card is gone and the feed asks the same
// question for every row, so the vocabulary lives here with the function now.

/**
 * What a member's relationship to one shift is.
 *
 *   yours       your turn, nobody covering.
 *   handed-off  you gave this turn away, and can take it back.
 *   covering    you took someone else's turn, so "why am I down for the bins?"
 *               has an answer on the row itself.
 */
export type ShiftState =
  | { kind: "yours" }
  | { kind: "handed-off"; to: string }
  | { kind: "covering"; forName: string };

/**
 * Which state this member sees for one shift, or `null` when the shift does not
 * concern them at all — which, on a whole-house feed, is most of them. A `null` row
 * is still rendered; it just carries no YOU tag and no action.
 */
export function shiftStateFor(shift: MemberShift, memberId: number): ShiftState | null {
  const iAmAssignee = shift.assigned_member.id === memberId;
  const iAmCovering = shift.covering_member?.id === memberId;

  if (iAmAssignee) {
    return shift.covering_member
      ? { kind: "handed-off", to: shift.covering_member.name }
      : { kind: "yours" };
  }
  if (iAmCovering) {
    return { kind: "covering", forName: shift.assigned_member.name };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/shift-view.test.ts' && npm run typecheck
```

Expected: PASS. `shift-list.tsx` still imports `coverTargetsFor`, so **typecheck will fail here** with `Module '"./shift-view"' has no exported member 'coverTargetsFor'`. That is expected and is fixed in Group D when `shift-list.tsx` is deleted. If you need a green typecheck before then, run Task D1 first; otherwise record the single expected error and move on.

- [ ] **Step 5: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add 'apps/web/src/app/(member)/s/[token]/shift-view.ts' 'apps/web/src/app/(member)/s/[token]/shift-view.test.ts'
git commit -m "BLO-1666: shift-view owns ShiftState; coverTargetsFor superseded by cover-ranking

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

**Definition of done for Group B:** `npx vitest run` passes for `member.test.ts`, `schedule-view.test.ts`, `cover-ranking.test.ts` and `shift-view.test.ts`; `npm run lint` is clean; the only typecheck error in the tree is the one `shift-list.tsx` produces, which Group D removes.

---

# Group C: the UI

Depends on Group B. Seven tasks. Nothing here fetches; every component takes plain data and callbacks. No component ever receives the token.

### Task C1: the responsive shell (container width and the desktop media query)

**Files:**
- Modify: `apps/web/src/components/container.tsx`
- Modify: `apps/web/src/app/(member)/layout.tsx`
- Create: `apps/web/src/hooks/use-is-desktop.ts`

**Interfaces:**
- Produces: `<Container width="feed">`; `useIsDesktop(): boolean` — consumed by `hand-off-sheet.tsx` (Task C6) and `member-feed.tsx` (Task C7).

**Why:** `Container`'s `member` width is `max-w-lg` (512px), which cannot hold the spec's two-column desktop layout (feed plus a 360px sidebar). `feed` keeps the phone measure and widens from `lg` up. This is the smallest change that satisfies spec section 3.2.

- [ ] **Step 1: Add the `feed` width**

In `apps/web/src/components/container.tsx`, extend the doc comment list and the union, and add the class:

```tsx
 *   admin   max-w-5xl  — dashboards and tables
 *   prose   max-w-2xl  — a rota editor, a settings form
 *   member  max-w-lg   — the single-column phone page
 *   feed    max-w-lg, then max-w-5xl from lg — the member feed, which is one
 *           column on a phone and a feed plus a sidebar on a desktop
```

```tsx
  width = "admin",
  …
  width?: "admin" | "prose" | "member" | "feed";
```

```tsx
        width === "member" && "max-w-lg",
        width === "feed" && "max-w-lg lg:max-w-5xl",
```

- [ ] **Step 2: Point the member layout at it**

In `apps/web/src/app/(member)/layout.tsx`, change both `<Container width="member" asChild>` occurrences to `<Container width="feed" asChild>`, and update the doc comment's "Single column, comfortable measure, thumb-reachable." sentence to:

```tsx
 * One column on a phone. From 1024px the same page becomes a feed with a
 * sidebar, so the gutter widens with it; below that nothing changes.
```

- [ ] **Step 3: Add the desktop media query hook**

Create `apps/web/src/hooks/use-is-desktop.ts`:

```ts
"use client";

import * as React from "react";

// The one viewport question this product asks in JavaScript. Everything else is a
// Tailwind breakpoint; this exists only because the hand-off flow is a genuinely
// DIFFERENT component on each side of the line (a bottom Sheet on a phone, a centred
// Dialog on a desktop), and CSS cannot swap a component.
//
// 1024px is Tailwind's `lg`, the same line the feed's two-column layout uses.
//
// useSyncExternalStore, not useEffect: the server snapshot is `false`, so the first
// paint is the PHONE layout everywhere, and a desktop upgrades on hydration. That is
// the right default (this page is opened from a text message) and it makes the
// server and client render agree, which an effect-based read would not.
const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useIsDesktop(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}
```

- [ ] **Step 4: Verify**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint && npx vitest run
```

Expected: lint clean; the existing suite unchanged. (`use-is-desktop.ts` has no unit test: it is a thin wrapper over `matchMedia`, which the node test environment does not provide. It is covered by the manual QA in Group E at 390px and 1440px.)

- [ ] **Step 5: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/web/src/components/container.tsx 'apps/web/src/app/(member)/layout.tsx' apps/web/src/hooks/use-is-desktop.ts
git commit -m "BLO-1666: feed container width and the desktop media query hook

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task C2: `use-shift-updates.ts`

The shift-state reducer currently inside `shift-list.tsx`, lifted so both a feed row and the hand-off sheet share one copy.

**Files:**
- Create: `apps/web/src/app/(member)/s/[token]/use-shift-updates.ts`

**Interfaces:**
- Consumes: `CoverActionResult` from `./action-result`; `MemberShift` from `@/lib/api/types`.
- Produces:
  - `type AssignAction = (shiftId: number, coveringMemberId: number) => Promise<CoverActionResult>`
  - `type CancelAction = (shiftId: number) => Promise<CoverActionResult>`
  - `function useShiftUpdates(initial: MemberShift[]): { shifts: MemberShift[]; applyUpdate: (shift: MemberShift) => void }`
  - `function runAction<T>(call: () => Promise<CoverActionResult>): Promise<CoverActionResult>`

- [ ] **Step 1: Write the hook**

Create `apps/web/src/app/(member)/s/[token]/use-shift-updates.ts`:

```ts
"use client";

import * as React from "react";

import type { MemberShift } from "@/lib/api/types";

import type { CoverActionResult } from "./action-result";

// The shift list's one piece of state, shared by the feed rows and the hand-off sheet
// so a hand-off arranged from either place updates the same array.
//
// This used to live inside shift-list.tsx, where it also DROPPED a shift that stopped
// involving the viewer. The feed shows the whole house, so nothing is ever dropped now:
// a shift you hand on stays on the page under its new owner's name, which is what a
// reload would show and is the point of a whole-house feed.

/** Hand this shift to another member. Bound to the token server-side; ids only here. */
export type AssignAction = (shiftId: number, coveringMemberId: number) => Promise<CoverActionResult>;

/** Take this shift back. Bound to the token server-side; the shift id only here. */
export type CancelAction = (shiftId: number) => Promise<CoverActionResult>;

export function useShiftUpdates(initial: MemberShift[]) {
  const [shifts, setShifts] = React.useState(initial);

  // The page is force-dynamic, but a client-side navigation back to it hands the
  // component a fresh `initial` without remounting. Re-seed on identity change so the
  // feed never shows a stale array after a refresh.
  React.useEffect(() => {
    setShifts(initial);
  }, [initial]);

  // Replace the mutated shift with the server's authoritative version. Its can_* flags
  // are already resolved for this member, so every control re-renders from one value
  // rather than from a guess about what the mutation did.
  const applyUpdate = React.useCallback((updated: MemberShift) => {
    setShifts((prev) => prev.map((shift) => (shift.id === updated.id ? updated : shift)));
  }, []);

  return { shifts, applyUpdate };
}

/**
 * A Server Action can THROW only for a genuinely unreachable API; every ApiError comes
 * back as a value. Normalise the throw into the same shape so callers handle one case.
 */
export async function runAction(call: () => Promise<CoverActionResult>): Promise<CoverActionResult> {
  try {
    return await call();
  } catch {
    return { ok: false, error: { error: "request_failed" } };
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint
```

Expected: clean. (`npm run typecheck` still carries the expected `shift-list.tsx` error until Group D.)

- [ ] **Step 3: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add 'apps/web/src/app/(member)/s/[token]/use-shift-updates.ts'
git commit -m "BLO-1666: use-shift-updates — one shift array for the feed and the sheet

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task C3: `shift-row.tsx` and `week-section.tsx`

**Files:**
- Create: `apps/web/src/components/member/shift-row.tsx`
- Create: `apps/web/src/components/member/week-section.tsx`

**Interfaces:**
- Consumes: `ShiftState`, `shiftStateFor` from `../../app/(member)/s/[token]/shift-view` — import as `@/app/(member)/s/[token]/shift-view`; `DayRow`, `WeekSection as WeekSectionModel` from `@/app/(member)/s/[token]/schedule-view`; `avatarTint`, `initials`, `capitalise`, `relativeDay`, `formatDayNumber`, `formatMonthShort`, `civilDate`.
- Produces: `<ShiftRow>` and `<WeekSection>`, consumed by `member-feed.tsx` (Task C7).

- [ ] **Step 1: Write `shift-row.tsx`**

Create `apps/web/src/components/member/shift-row.tsx`:

```tsx
"use client";

import { ArrowRightLeft } from "lucide-react";

import { shiftStateFor } from "@/app/(member)/s/[token]/shift-view";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MemberShift } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One shift on one day of the feed: the job, who is on it, and what the viewer can do
 * about it.
 *
 * A row the viewer is on is LIT — the lemon "now" wash plus a grape outline, the two
 * colours the system already uses for "this is the thing in front of you" — and wears
 * a YOU tag, so a member scanning the whole house's rota finds their own turns without
 * reading a single name. Everyone else's rows stay quiet.
 *
 * Presentational. The two actions are callbacks; this component never calls the API.
 */
export function ShiftRow({
  shift,
  viewerId,
  onHandOff,
  onTakeBack,
}: {
  shift: MemberShift;
  viewerId: number;
  onHandOff: (shift: MemberShift) => void;
  onTakeBack: (shift: MemberShift) => void;
}) {
  const state = shiftStateFor(shift, viewerId);
  const mine = state !== null;
  const person = shift.responsible_member;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
        // The lemon "now" wash at a quarter strength, like every other tint in the
        // system, with the grape outline inset so it never shifts the row's height.
        mine && "bg-lemon/25 outline-2 -outline-offset-2 outline-primary/40",
      )}
    >
      <Avatar size="sm">
        <AvatarFallback className={cn(avatarTint(person.name), "text-foreground text-[10px]")}>
          {initials(person.name)}
        </AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{shift.rota_name}</span>
        <span className="text-muted-foreground block truncate text-sm">
          {shift.covered && shift.covering_member ? (
            <>
              {shift.covering_member.name} covering {shift.assigned_member.name}
            </>
          ) : (
            person.name
          )}
        </span>
      </span>

      {mine ? (
        <Badge variant="warning" className="shrink-0">
          You
        </Badge>
      ) : null}

      {shift.covered ? (
        <Badge variant="info" className="shrink-0">
          <ArrowRightLeft aria-hidden />
          Cover
        </Badge>
      ) : null}

      {/* The two controls are mutually exclusive: the API resolves them for this
          member, and a shift too soon to touch (today's turn) shows neither. */}
      {shift.can_assign_cover ? (
        <Button variant="link" size="sm" className="shrink-0 px-0" onClick={() => onHandOff(shift)}>
          Hand off
        </Button>
      ) : null}

      {shift.can_cancel_cover && shift.covering_member ? (
        <Button variant="link" size="sm" className="shrink-0 px-0" onClick={() => onTakeBack(shift)}>
          Take it back
        </Button>
      ) : null}
    </li>
  );
}
```

- [ ] **Step 2: Write `week-section.tsx`**

Create `apps/web/src/components/member/week-section.tsx`:

```tsx
"use client";

import type { WeekSection as WeekSectionModel } from "@/app/(member)/s/[token]/schedule-view";
import { ShiftRow } from "@/components/member/shift-row";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { MemberShift } from "@/lib/api/types";
import { formatDayNumber, formatMonthShort, formatShiftDate, relativeDay } from "@/lib/date";
import { capitalise } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

// A DATE COIN per day, the same page-a-day calendar leaf the dashboard's week glance
// uses, so the two surfaces speak one language. Today wears peach (the thing in front
// of you), tomorrow lemon (one sleep away), the rest lilac (quiet). The coins are
// stickers: theme-independent, and their ink is always plum.
const COIN_STYLE = {
  today: "bg-peach text-plum",
  tomorrow: "bg-lemon text-plum",
  later: "bg-lilac text-plum",
} as const;

/** One week of the feed: its label, then a card per day. */
export function WeekSection({
  week,
  today,
  viewerId,
  onHandOff,
  onTakeBack,
}: {
  week: WeekSectionModel;
  /** The group's today as a civil date; the reference every relative day is measured from. */
  today: string;
  viewerId: number;
  onHandOff: (shift: MemberShift) => void;
  onTakeBack: (shift: MemberShift) => void;
}) {
  const todayDate = civilDate(today);

  return (
    <section>
      <h2 className="font-heading text-muted-foreground mb-3 text-sm font-semibold">
        {week.label}
      </h2>

      <div className="space-y-4">
        {week.days.map((day) => {
          const date = civilDate(day.due_on);
          const when = relativeDay(date, todayDate);
          const coin =
            when === "today"
              ? COIN_STYLE.today
              : when === "tomorrow"
                ? COIN_STYLE.tomorrow
                : COIN_STYLE.later;

          return (
            <div key={day.due_on}>
              <h3 className="mb-2 flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-11 shrink-0 flex-col items-center justify-center rounded-xl shadow-xs",
                    coin,
                  )}
                  aria-hidden
                >
                  <span className="text-[0.55rem] font-bold tracking-widest uppercase">
                    {formatMonthShort(date)}
                  </span>
                  <span className="font-heading text-lg leading-none font-bold" data-numeric>
                    {formatDayNumber(date)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{formatShiftDate(date)}</span>
                  {when === "today" ? (
                    <Badge variant="warning">Today</Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">{capitalise(when)}</span>
                  )}
                </span>
              </h3>

              <Card className="gap-0 overflow-hidden py-0">
                <ul className="divide-border divide-y">
                  {day.shifts.map((shift) => (
                    <ShiftRow
                      key={shift.id}
                      shift={shift}
                      viewerId={viewerId}
                      onHandOff={onHandOff}
                      onTakeBack={onTakeBack}
                    />
                  ))}
                </ul>
              </Card>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/web/src/components/member/shift-row.tsx apps/web/src/components/member/week-section.tsx
git commit -m "BLO-1666: shift row and week section

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task C4: `next-shift-card.tsx`

**Files:**
- Create: `apps/web/src/components/member/next-shift-card.tsx`

**Interfaces:**
- Consumes: `shiftStateFor` from `@/app/(member)/s/[token]/shift-view`; `MemberShift`.
- Produces: `<NextShiftCard shifts viewerId today onHandOff />`. Used by `member-feed.tsx` in both the phone lead position and the desktop "You" sidebar card.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/member/next-shift-card.tsx`:

```tsx
"use client";

import { ArrowRightLeft, CalendarCheck } from "lucide-react";

import { shiftStateFor } from "@/app/(member)/s/[token]/shift-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MemberShift } from "@/lib/api/types";
import { formatDayNumber, formatMonthShort, formatShiftDate, relativeDay } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

/**
 * What the member came for: the next turn they are actually on the hook for, with the
 * one action that matters on it. Up to two more are named in a single quiet line
 * underneath, because "and then?" is the second question and a second card would
 * compete with the feed.
 *
 * `shifts` is the viewer's own upcoming turns in order (schedule-view's
 * `responsibleShifts`). A shift they have handed away is NOT among them; it is in the
 * feed with its "Take it back".
 */
export function NextShiftCard({
  shifts,
  viewerId,
  today,
  onHandOff,
  className,
}: {
  shifts: MemberShift[];
  viewerId: number;
  /** The group's today as a civil date (YYYY-MM-DD). */
  today: string;
  onHandOff: (shift: MemberShift) => void;
  className?: string;
}) {
  const todayDate = civilDate(today);
  const [next, ...rest] = shifts;

  if (!next) {
    return (
      <Card className={cn("items-center gap-3 py-8 text-center", className)}>
        <CalendarCheck className="text-muted-foreground size-7" aria-hidden />
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">Nothing on your plate</h2>
          <p className="text-muted-foreground text-sm text-pretty">
            You are not down for anything right now. Here is what the rest of the house is up to.
          </p>
        </div>
      </Card>
    );
  }

  const date = civilDate(next.due_on);
  const when = relativeDay(date, todayDate);
  const soon = when === "today" || when === "tomorrow";
  const state = shiftStateFor(next, viewerId);

  return (
    <Card className={className}>
      <div className="flex items-start gap-4 px-(--card-spacing)">
        <span
          className="bg-peach text-plum flex size-14 shrink-0 flex-col items-center justify-center rounded-xl shadow-xs"
          aria-hidden
        >
          <span className="text-[0.625rem] leading-none font-bold tracking-widest uppercase">
            {formatMonthShort(date)}
          </span>
          <span className="font-heading mt-1 text-xl leading-none font-bold" data-numeric>
            {formatDayNumber(date)}
          </span>
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="font-heading text-lg leading-snug font-semibold text-pretty">
            {next.rota_name}
          </h2>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <time>{formatShiftDate(date)}</time>
            {soon ? (
              <Badge variant="warning">{when}</Badge>
            ) : (
              <span className="text-foreground font-medium">{when}</span>
            )}
          </p>
        </div>
      </div>

      <CardContent className="space-y-3 empty:hidden">
        {state?.kind === "covering" ? (
          // A name can be long and the phone is 390px wide, so this one badge wraps.
          <Badge
            variant="info"
            className="h-auto max-w-full items-start py-1 text-left whitespace-normal"
          >
            <ArrowRightLeft className="mt-0.5" aria-hidden />
            You are covering for {state.forName}
          </Badge>
        ) : null}

        {next.can_assign_cover ? (
          <Button size="lg" className="w-full" onClick={() => onHandOff(next)}>
            Hand off
          </Button>
        ) : null}

        {rest.length > 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Then{" "}
            {rest.slice(0, 2).map((shift, index) => (
              <span key={shift.id}>
                {index > 0 ? ", " : ""}
                <span className="text-foreground font-medium">{shift.rota_name}</span>{" "}
                {formatShiftDate(civilDate(shift.due_on))}
              </span>
            ))}
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/web/src/components/member/next-shift-card.tsx
git commit -m "BLO-1666: next-shift card, with the 'Then ...' line and the empty state

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task C5: `people-strip.tsx`, `people-card.tsx`, `filter-chips.tsx`

**Files:**
- Create: `apps/web/src/components/member/people-strip.tsx`
- Create: `apps/web/src/components/member/people-card.tsx`
- Create: `apps/web/src/components/member/filter-chips.tsx`

**Interfaces:**
- Consumes: `ScheduleMember`, `RotaRef`, `MemberShift`; `RotaFilter` from `@/app/(member)/s/[token]/schedule-view`; `avatarTint`, `initials`, `formatShiftDate`, `civilDate`.
- Produces: `<PeopleStrip>`, `<PeopleCard>`, `<FilterChips>`, all consumed by `member-feed.tsx`.

- [ ] **Step 1: Write `people-strip.tsx`**

```tsx
"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ScheduleMember } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Everyone who lives here, as a row of pastel coins. Tapping one narrows the feed to
 * that person; tapping the selected one clears it.
 *
 * An opted-out housemate is MUTED, not hidden. They still live here, and the hand-off
 * sheet is where "can't be texted" is explained; removing them from the strip would
 * read as "they moved out".
 *
 * Phone only. The desktop layout uses PeopleCard, whose rows are the same filter.
 */
export function PeopleStrip({
  members,
  viewerId,
  selectedId,
  onSelect,
}: {
  members: ScheduleMember[];
  viewerId: number;
  selectedId: number | null;
  onSelect: (memberId: number | null) => void;
}) {
  return (
    <div
      // The strip scrolls rather than wrapping: a big house should not push the feed
      // off the first screen. -mx-5 lets it bleed to the gutter edge so the last
      // avatar is visibly cut off, which is what says "there is more".
      className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 md:-mx-8 md:px-8"
      role="group"
      aria-label="Filter by housemate"
    >
      {members.map((member) => {
        const selected = member.id === selectedId;
        return (
          <button
            key={member.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : member.id)}
            className={cn(
              "focus-visible:outline-ring flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-2xl py-2 focus-visible:outline-2 focus-visible:outline-offset-2",
              selected && "bg-lemon/25",
              !member.contactable && "opacity-60",
            )}
          >
            <Avatar
              size="lg"
              className={cn(selected && "ring-primary ring-2 ring-offset-2 ring-offset-background")}
            >
              <AvatarFallback className={cn(avatarTint(member.name), "text-foreground text-sm")}>
                {initials(member.name)}
              </AvatarFallback>
            </Avatar>
            <span className="w-full truncate px-0.5 text-center text-xs font-medium">
              {member.id === viewerId ? "You" : member.name.split(" ")[0]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write `people-card.tsx`**

```tsx
"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MemberShift, ScheduleMember } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { formatShiftDate } from "@/lib/date";
import { initials } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

/**
 * The desktop sidebar's people list. Same filter as the phone's people strip, but with
 * room to say what each person is next down for, which is the question you ask just
 * before you decide who to text.
 */
export function PeopleCard({
  members,
  viewerId,
  nextShifts,
  selectedId,
  onSelect,
}: {
  members: ScheduleMember[];
  viewerId: number;
  /** Each person's next responsible shift, keyed by member id. */
  nextShifts: Map<number, MemberShift>;
  selectedId: number | null;
  onSelect: (memberId: number | null) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-sm">People</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <ul>
          {members.map((member) => {
            const selected = member.id === selectedId;
            const next = nextShifts.get(member.id);
            return (
              <li key={member.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : member.id)}
                  className={cn(
                    "hover:bg-accent focus-visible:outline-ring flex w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:outline-2 -outline-offset-2",
                    selected && "bg-lemon/25",
                    !member.contactable && "opacity-60",
                  )}
                >
                  <Avatar size="sm">
                    <AvatarFallback
                      className={cn(avatarTint(member.name), "text-foreground text-[10px]")}
                    >
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {member.id === viewerId ? `${member.name} (you)` : member.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {next
                        ? `${next.rota_name} · ${formatShiftDate(civilDate(next.due_on))}`
                        : "Nothing coming up"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Write `filter-chips.tsx`**

```tsx
"use client";

import type { RotaFilter } from "@/app/(member)/s/[token]/schedule-view";
import type { RotaRef } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Everyone / Just me / one chip per rota. The chips WRAP onto a second line rather
 * than scrolling: unlike the people strip, a house has a handful of rotas and a
 * clipped one would hide a filter the member cannot discover any other way.
 *
 * "Everyone" is the clear: it resets the rota half of the filter. The person half is
 * cleared from the people strip, by tapping the selected avatar again.
 */
export function FilterChips({
  rotas,
  value,
  onChange,
}: {
  rotas: RotaRef[];
  value: RotaFilter;
  onChange: (next: RotaFilter) => void;
}) {
  const chips: { key: string; label: string; filter: RotaFilter }[] = [
    { key: "everyone", label: "Everyone", filter: { kind: "everyone" } },
    { key: "me", label: "Just me", filter: { kind: "me" } },
    ...rotas.map((rota) => ({
      key: `rota-${rota.id}`,
      label: rota.name,
      filter: { kind: "rota" as const, rotaId: rota.id },
    })),
  ];

  const isActive = (filter: RotaFilter) =>
    filter.kind === value.kind &&
    (filter.kind !== "rota" || value.kind !== "rota" || filter.rotaId === value.rotaId);

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the rota">
      {chips.map((chip) => {
        const active = isActive(chip.filter);
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.filter)}
            className={cn(
              "focus-visible:outline-ring inline-flex h-11 max-w-full items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
              active
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary text-secondary-foreground hover:bg-lilac-deep",
            )}
          >
            <span className="truncate">{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/web/src/components/member/people-strip.tsx apps/web/src/components/member/people-card.tsx apps/web/src/components/member/filter-chips.tsx
git commit -m "BLO-1666: people strip, people card and filter chips

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task C6: `hand-off-sheet.tsx`

**Files:**
- Create: `apps/web/src/components/member/hand-off-sheet.tsx`

**Interfaces:**
- Consumes: `rankCoverCandidates`, `CoverCandidate` from `@/app/(member)/s/[token]/cover-ranking`; `AssignAction` from `@/app/(member)/s/[token]/use-shift-updates`; `useIsDesktop` from `@/hooks/use-is-desktop`; `Sheet*`, `Dialog*`, `Button`, `Badge`, `Avatar`; `toastApiError` from `@/lib/api/toast`; `toast` from `sonner`.
- Produces: `<HandOffSheet shift schedule open onOpenChange assignAction onUpdated />`.

**Copy check before writing the footnote:** `apps/api/app/controllers/api/member_covers_controller.rb` enqueues a `CoverNotice` to "everyone whose turn actually changed, minus the caller", and `Shift#responsible_member` resolves `covering_member || assigned_member` at reminder SEND time. So the true behaviour is: the chosen person gets a text now, and every remaining reminder for this shift goes to them. Write that, and change it only if you find the API does something else.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import type { CoverCandidate } from "@/app/(member)/s/[token]/cover-ranking";
import { rankCoverCandidates } from "@/app/(member)/s/[token]/cover-ranking";
import type { AssignAction } from "@/app/(member)/s/[token]/use-shift-updates";
import { runAction } from "@/app/(member)/s/[token]/use-shift-updates";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { toastApiError } from "@/lib/api/toast";
import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { formatLongDate, formatShiftDate, relativeDay } from "@/lib/date";
import { initials } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

// Handing a shift on, on both viewports. A bottom SHEET on a phone (a thumb reaches
// the bottom of a 390px screen, not the middle of it) and a centred DIALOG on a
// desktop. The contents are identical, which is why they are one component: two
// copies would drift, and this is the screen where a wrong name gets somebody texted.
//
// The candidates are ranked rather than listed, because a flat list of names makes
// every housemate look equally free. See cover-ranking.ts for the rules.

const GROUP_LABELS = {
  free: "Free that week",
  busy: "Has a shift that week",
  unavailable: "Can't be texted",
} as const;

export function HandOffSheet({
  shift,
  schedule,
  open,
  onOpenChange,
  assignAction,
  onUpdated,
}: {
  /** The shift being handed off, or null when the sheet is closed. */
  shift: MemberShift | null;
  schedule: MemberScheduleResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignAction: AssignAction;
  onUpdated: (shift: MemberShift) => void;
}) {
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState(false);

  // Nothing is preselected, ever: this action texts a real person, so it must be a
  // deliberate choice and not whatever happened to be first.
  React.useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  if (!shift) return null;

  const ranked = rankCoverCandidates(shift, schedule);
  const selectable = [...ranked.free, ...ranked.busy];
  const selected = selectable.find((candidate) => candidate.member.id === selectedId) ?? null;
  const date = civilDate(shift.due_on);
  const when = relativeDay(date, civilDate(schedule.today));
  const nobody = ranked.free.length + ranked.busy.length + ranked.unavailable.length === 0;

  function change(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  async function confirm() {
    // Re-entry guard: this POST texts the person picked, so a double tap must not fire
    // it twice. The button is disabled while pending too, but guard here in case two
    // taps queue before the disable commits.
    if (!shift || !selected || pending) return;
    setPending(true);
    const result = await runAction(() => assignAction(shift.id, selected.member.id));
    setPending(false);

    if (!result.ok) {
      // A human sentence, never a code. Stay open so they can pick someone else, e.g.
      // if that person just opted out.
      toastApiError(result.error, "Couldn't send that just now. Try again.");
      return;
    }
    onUpdated(result.shift);
    toast.success(`${selected.member.name} is covering. We'll text them to let them know.`);
    onOpenChange(false);
  }

  const title = `Hand off ${shift.rota_name}`;
  const subtitle = `${formatLongDate(date)} · ${when}`;

  const body = nobody ? (
    <p className="text-muted-foreground px-5 text-sm text-pretty">
      No one else can cover yet. Whoever runs your rota can add more people to the house.
    </p>
  ) : (
    <div
      role="radiogroup"
      aria-label="Who to hand it to"
      // A big house makes a long list and this opens on a phone: cap the height and
      // let the names scroll rather than pushing the footer off the screen.
      className="max-h-[50vh] space-y-4 overflow-y-auto px-5"
    >
      {(["free", "busy", "unavailable"] as const).map((group) =>
        ranked[group].length === 0 ? null : (
          <div key={group} className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {GROUP_LABELS[group]}
            </p>
            <ul className="space-y-1.5">
              {ranked[group].map((candidate) => (
                <CandidateRow
                  key={candidate.member.id}
                  candidate={candidate}
                  today={schedule.today}
                  selectable={group !== "unavailable"}
                  selected={selectedId === candidate.member.id}
                  disabled={pending}
                  onSelect={() => setSelectedId(candidate.member.id)}
                />
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );

  const footnote = (
    <p className="text-muted-foreground px-5 pb-1 text-xs text-pretty">
      We text them straight away, and every reminder left for this shift goes to them instead of you.
    </p>
  );

  const actions = (
    <>
      <Button variant="secondary" size="lg" onClick={() => change(false)} disabled={pending}>
        Cancel
      </Button>
      {nobody ? null : (
        // `disabled={!selected || pending}`, NOT `loading` alone: Button derives its
        // disabled state as `disabled ?? loading`, so an explicit `disabled={false}`
        // would shortcut it and a double tap would text twice.
        <Button size="lg" onClick={confirm} disabled={!selected || pending} loading={pending}>
          {selected ? `Hand off to ${selected.member.name}` : "Hand off"}
        </Button>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="gap-4 px-0">
          <DialogHeader className="px-5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>
          {body}
          {nobody ? null : footnote}
          <DialogFooter className="px-5">{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent side="bottom" className="max-h-[90vh] gap-4 pb-6">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>
        {body}
        {nobody ? null : footnote}
        <SheetFooter>{actions}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** One name, with the reason it is in the group it is in. */
function CandidateRow({
  candidate,
  today,
  selectable,
  selected,
  disabled,
  onSelect,
}: {
  candidate: CoverCandidate;
  today: string;
  selectable: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { member, weekShifts } = candidate;
  const detail = selectable
    ? weekShifts
        .map((shift) => `${shift.rota_name} · ${formatShiftDate(civilDate(shift.due_on))}`)
        .join(", ")
    : "Not receiving texts right now";

  const content = (
    <>
      <Avatar size="sm">
        <AvatarFallback className={cn(avatarTint(member.name), "text-foreground text-[10px]")}>
          {initials(member.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{member.name}</span>
        {detail ? (
          <span className="text-muted-foreground block truncate text-xs">{detail}</span>
        ) : null}
      </span>
      {selected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
    </>
  );

  if (!selectable) {
    return (
      <li className="flex items-center gap-3 rounded-2xl px-3 py-2.5 opacity-60">{content}</li>
    );
  }

  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "focus-visible:outline-ring flex min-h-11 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60",
          selected ? "border-primary bg-lemon/25" : "border-border hover:bg-accent",
        )}
      >
        {content}
      </button>
    </li>
  );
}

// The `today` prop is threaded through for BLO-1667, which adds an "away" group whose
// rows need to name the dates someone is away. Keep it.
void 0;
```

Delete the trailing `void 0;` and the comment above it if lint flags them; the `today` prop on `CandidateRow` is genuinely unused today, so either drop the prop entirely or prefix it. **Preferred: drop the `today` prop from `CandidateRow` and its call site** — YAGNI, and BLO-1667 can add it back.

- [ ] **Step 2: Verify and commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add apps/web/src/components/member/hand-off-sheet.tsx
git commit -m "BLO-1666: hand-off sheet — bottom sheet on phone, dialog on desktop, ranked

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

---

### Task C7: `member-feed.tsx`

The client shell. Owns the filter state, the sheet state and the take-back confirmation.

**Files:**
- Create: `apps/web/src/app/(member)/s/[token]/member-feed.tsx`

**Interfaces:**
- Consumes: everything from Tasks B2, B3, C2–C6; `ConfirmDialog` from `@/components/confirm-dialog`; `EmptyState` from `@/components/empty-state`.
- Produces: `<MemberFeed schedule assignAction cancelAction />` — the single component `page.tsx` (Task D1) renders.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import * as React from "react";
import { CalendarX, Filter } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { FilterChips } from "@/components/member/filter-chips";
import { HandOffSheet } from "@/components/member/hand-off-sheet";
import { NextShiftCard } from "@/components/member/next-shift-card";
import { PeopleCard } from "@/components/member/people-card";
import { PeopleStrip } from "@/components/member/people-strip";
import { WeekSection } from "@/components/member/week-section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toastApiError } from "@/lib/api/toast";
import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";

import type { RotaFilter } from "./schedule-view";
import {
  ALL_SHIFTS,
  buildFeed,
  nextShiftByMember,
  responsibleShifts,
} from "./schedule-view";
import type { AssignAction, CancelAction } from "./use-shift-updates";
import { runAction, useShiftUpdates } from "./use-shift-updates";

// The interactive half of the member page: the whole house's rota, the filters over
// it, and the one thing a member came to do — hand a shift on, or take it back.
//
// It never sees the magic-link token. The two mutations arrive already bound to it
// (server-side, in page.tsx), so this component supplies only shift and member ids.
// Each successful mutation returns the shift resolved for THIS member, and the row
// re-renders from that one authoritative value.

// Four weeks up front. The payload covers the generator's whole 90-day window, so
// "Show more weeks" reveals the rest with no request — a member on a train should not
// need a second round trip to see October.
const INITIAL_WEEKS = 4;

export function MemberFeed({
  schedule,
  assignAction,
  cancelAction,
}: {
  schedule: MemberScheduleResponse;
  assignAction: AssignAction;
  cancelAction: CancelAction;
}) {
  const { shifts, applyUpdate } = useShiftUpdates(schedule.shifts);
  const live = React.useMemo<MemberScheduleResponse>(
    () => ({ ...schedule, shifts }),
    [schedule, shifts],
  );

  const [rotaFilter, setRotaFilter] = React.useState<RotaFilter>(ALL_SHIFTS.rota);
  const [personId, setPersonId] = React.useState<number | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [handingOff, setHandingOff] = React.useState<MemberShift | null>(null);
  const [takingBack, setTakingBack] = React.useState<MemberShift | null>(null);

  const filter = React.useMemo(() => ({ rota: rotaFilter, personId }), [rotaFilter, personId]);
  const weeks = React.useMemo(() => buildFeed(live, filter), [live, filter]);
  const mine = React.useMemo(() => responsibleShifts(live), [live]);
  const nextByMember = React.useMemo(() => nextShiftByMember(live), [live]);

  const filtered = rotaFilter.kind !== "everyone" || personId !== null;
  const visible = expanded ? weeks : weeks.slice(0, INITIAL_WEEKS);

  function clearFilters() {
    setRotaFilter(ALL_SHIFTS.rota);
    setPersonId(null);
  }

  async function takeBack(shift: MemberShift) {
    const result = await runAction(() => cancelAction(shift.id));
    if (!result.ok) {
      toastApiError(result.error, "Couldn't take it back just now. Try again.");
      // Re-throw so ConfirmDialog stays OPEN (its contract: a rejected onConfirm leaves
      // the dialog up to retry or cancel). Returning would close it right after the
      // error toast, stranding a network blip.
      throw new Error("cancel-cover-failed");
    }
    applyUpdate(result.shift);
    setTakingBack(null);
    toast.success("Got it. You're back down for this one.");
  }

  const feed =
    weeks.length === 0 ? (
      filtered ? (
        <EmptyState
          icon={Filter}
          title="No shifts for this filter"
          description="Nothing matches that just now."
          action={
            <Button size="lg" onClick={clearFilters}>
              Show everyone
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={CalendarX}
          title="Nothing on the rota yet"
          description="Whoever runs your rota has not set anything up. We'll text you as soon as they do."
        />
      )
    ) : (
      <>
        <div className="space-y-8">
          {visible.map((week) => (
            <WeekSection
              key={week.weekStart}
              week={week}
              today={schedule.today}
              viewerId={schedule.member.id}
              onHandOff={setHandingOff}
              onTakeBack={setTakingBack}
            />
          ))}
        </div>
        {!expanded && weeks.length > INITIAL_WEEKS ? (
          <Button variant="secondary" size="lg" className="w-full" onClick={() => setExpanded(true)}>
            Show more weeks
          </Button>
        ) : null}
      </>
    );

  return (
    <>
      <div className="lg:flex lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1 space-y-6">
          {/* Phone lead card. On desktop the same card is the sidebar's "You" card. */}
          <div className="lg:hidden">
            <NextShiftCard
              shifts={mine}
              viewerId={schedule.member.id}
              today={schedule.today}
              onHandOff={setHandingOff}
            />
          </div>

          <div className="lg:hidden">
            <PeopleStrip
              members={schedule.members}
              viewerId={schedule.member.id}
              selectedId={personId}
              onSelect={setPersonId}
            />
          </div>

          <FilterChips rotas={schedule.rotas} value={rotaFilter} onChange={setRotaFilter} />

          {feed}
        </div>

        <aside className="hidden w-[360px] shrink-0 space-y-4 lg:block">
          <NextShiftCard
            shifts={mine.slice(0, 3)}
            viewerId={schedule.member.id}
            today={schedule.today}
            onHandOff={setHandingOff}
          />
          <PeopleCard
            members={schedule.members}
            viewerId={schedule.member.id}
            nextShifts={nextByMember}
            selectedId={personId}
            onSelect={setPersonId}
          />
        </aside>
      </div>

      <HandOffSheet
        shift={handingOff}
        schedule={live}
        open={handingOff !== null}
        onOpenChange={(open) => setHandingOff(open ? handingOff : null)}
        assignAction={assignAction}
        onUpdated={applyUpdate}
      />

      {takingBack && takingBack.covering_member ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => setTakingBack(open ? takingBack : null)}
          title="Take this shift back?"
          description={`${takingBack.covering_member.name} is covering ${takingBack.rota_name} on ${formatShiftDate(
            civilDate(takingBack.due_on),
          )} (${relativeDay(civilDate(takingBack.due_on), civilDate(schedule.today))}). Take it back and you're down for it again. We'll let ${takingBack.covering_member.name} know.`}
          confirmLabel="Take it back"
          onConfirm={() => takeBack(takingBack)}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run lint
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add 'apps/web/src/app/(member)/s/[token]/member-feed.tsx'
git commit -m "BLO-1666: member-feed shell — filters, layout, hand-off and take-back

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

**Definition of done for Group C:** every component compiles, `npm run lint` is clean, no component imports `server-only` code, no component receives a `token` prop, every chip and avatar button carries `aria-pressed`, and every tappable control on the phone layout is at least 44px tall.

---

# Group D: integration

Depends on A, B and C.

### Task D1: wire `page.tsx`, extend the token-safety test, remove the dead files

**Files:**
- Modify: `apps/web/src/app/(member)/s/[token]/page.tsx`
- Modify: `apps/web/src/app/(member)/s/[token]/page.token-safety.test.ts`
- Modify: `apps/web/src/app/(member)/s/[token]/loading.tsx`
- Delete: `apps/web/src/app/(member)/s/[token]/shift-list.tsx`
- Delete: `apps/web/src/components/member/shift-card.tsx`

- [ ] **Step 1: Update the token-safety test first**

In `apps/web/src/app/(member)/s/[token]/page.token-safety.test.ts`:

Change the type import and the mocks:

```ts
import type { MemberScheduleResponse } from "@/lib/api/types";
```

```ts
vi.mock("@/lib/api/member", () => ({
  getMemberSchedule: vi.fn(),
  assignCover: vi.fn(),
  cancelCover: vi.fn(),
}));

// Stub the client tree so importing the page doesn't pull client-only deps (sonner,
// radix) into the node runner. We inspect only the PROPS the page hands it — which is
// the boundary the token must not cross.
vi.mock("./member-feed", () => ({ MemberFeed: () => null }));

const { getMemberSchedule } = await import("@/lib/api/member");
```

Replace the `RESPONSE` fixture:

```ts
const RESPONSE: MemberScheduleResponse = {
  today: "2026-07-18",
  timezone: "Europe/London",
  member: { id: 1, name: "Alice Smith" },
  members: [
    { id: 1, name: "Alice Smith", contactable: true },
    { id: 2, name: "Bob", contactable: true },
  ],
  rotas: [{ id: 1, name: "Kitchen" }],
  shifts: [
    {
      id: 100,
      rota_id: 1,
      rota_name: "Kitchen",
      due_on: "2026-07-20",
      covered: false,
      assigned_member: { id: 1, name: "Alice Smith" },
      covering_member: null,
      responsible_member: { id: 1, name: "Alice Smith" },
      can_assign_cover: true,
      can_cancel_cover: false,
    },
  ],
};
```

and the one mock assignment in the first example:

```ts
    vi.mocked(getMemberSchedule).mockResolvedValue(RESPONSE);
```

Leave the `leaks` walker and the second ("guards against a vacuous check") example exactly as they are.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npx vitest run 'src/app/(member)/s/[token]/page.token-safety.test.ts'
```

Expected: FAIL — the page still imports `getMemberShifts` and `./shift-list`, which the new mocks no longer provide.

- [ ] **Step 3: Rewrite `page.tsx`**

Replace `apps/web/src/app/(member)/s/[token]/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { CloudOff } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { InvalidLink } from "@/components/member/invalid-link";
import { apiErrorMessage, isApiError } from "@/lib/api/errors";
import { getMemberSchedule } from "@/lib/api/member";
import { formatLongDate } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";

import { assignCoverAction, cancelCoverAction } from "./actions";
import { MemberFeed } from "./member-feed";

export const metadata: Metadata = {
  title: "Your rota",
  // A magic link is a per-person credential; it must never be crawled or cached by a
  // search engine that followed a leaked URL.
  robots: { index: false, follow: false },
};

// Live, per-request: this reads a per-member credential and must never be statically
// prerendered or cached across members.
export const dynamic = "force-dynamic";

/**
 * The page every SMS points at. `[token]` is the member's permanent magic link.
 *
 * The token stays on THIS side of the wire: it is read here, in a Server Component
 * (`await params`), and forwarded to Rails only as `Authorization: Bearer <token>` by
 * the `server-only` member client — never as a path segment (Rails logs paths verbatim
 * at info, and this credential does not expire). It reaches the client nowhere as a
 * value: the two cover mutations are bound to it here and handed to the feed as opaque
 * actions, so the browser gets the actions, not the token.
 */
export default async function MemberSchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let schedule;
  try {
    schedule = await getMemberSchedule(token);
  } catch (error) {
    // A bad, rotated or deactivated token authenticates as nobody: 401. Show the kind,
    // blameless dead-link page — no stack trace, no "404", no hint about why.
    if (isApiError(error) && error.status === 401) {
      return <InvalidLink />;
    }
    // A throttle (429) or a brief outage (5xx) is not a broken link. Show warm, human
    // copy from the shared error map — never a code — and keep the member surface.
    if (isApiError(error)) {
      return (
        <EmptyState
          icon={CloudOff}
          title="We couldn't load your rota"
          description={apiErrorMessage(error, "This one's on us, not you. Try again in a moment.")}
        />
      );
    }
    // Truly unexpected (the API host unreachable, so fetch rejected before Rails
    // answered): let the error boundary show its warm "try again".
    throw error;
  }

  const firstName = schedule.member.name.split(" ")[0];

  return (
    <>
      {/* The greeting. Fredoka, pressed wide, with a peach clay dot for a full stop:
          the whole flourish is one sticker, because this should read like a note left
          on the fridge rather than a dashboard heading. */}
      <div className="animate-rise mb-6">
        <h1 className="text-display font-heading text-pretty">
          Hi {firstName}
          <span
            className="bg-peach shadow-xs ml-2 inline-block size-3 rounded-full align-middle"
            aria-hidden
          />
        </h1>
        <p className="text-muted-foreground mt-3 text-[0.9375rem] text-pretty">
          {formatLongDate(civilDate(schedule.today))}. Here&apos;s what the whole house is up to.
        </p>
      </div>

      <MemberFeed
        schedule={schedule}
        assignAction={assignCoverAction.bind(null, token)}
        cancelAction={cancelCoverAction.bind(null, token)}
      />
    </>
  );
}
```

- [ ] **Step 4: Delete the replaced files**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
# Prove nothing still imports them BEFORE deleting.
grep -rn "shift-list\|shift-card\|ShiftList\|ShiftCard\|getMemberShifts" apps/web/src
git rm 'apps/web/src/app/(member)/s/[token]/shift-list.tsx' apps/web/src/components/member/shift-card.tsx
```

The grep must show no hits outside `apps/web/src/lib/api/member.ts` and `member.test.ts` (which keep `getMemberShifts`, since `GET /api/member/shifts` stays on the API and its removal is a later cleanup). If anything else appears, resolve it before deleting.

- [ ] **Step 5: Update the loading skeleton**

Replace the body of `apps/web/src/app/(member)/s/[token]/loading.tsx`'s default export so it holds the new shape: the greeting, the lead card, a row of avatar circles, a row of chips, and two day cards. Keep the existing doc comment's first paragraph and update its last line.

```tsx
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Shown while the rota streams in. It holds the page's real shape — a greeting, the
// next-shift card, the people strip, the filter chips and two day cards — so the
// layout doesn't jump when the feed arrives. It renders inside the member layout's own
// container, so no gutter of its own.
//
// Everything is a PILL except the date coins, which keep the coin's 18px radius: the
// placeholder should look like the clay it is about to become, not like a wireframe.
export default function Loading() {
  return (
    <div aria-busy aria-label="Loading your rota">
      <div className="mb-6">
        <Skeleton className="mb-3 h-10 w-44 rounded-full" />
        <Skeleton className="h-4 w-64 rounded-full" />
      </div>

      <Card className="mb-6">
        <div className="flex items-start gap-4 px-(--card-spacing)">
          <Skeleton className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2.5 pt-1">
            <Skeleton className="h-5 w-2/3 rounded-full" />
            <Skeleton className="h-4 w-1/2 rounded-full" />
          </div>
        </div>
      </Card>

      <div className="mb-6 flex gap-3">
        {[0, 1, 2, 3].map((person) => (
          <div key={person} className="flex w-16 flex-col items-center gap-1.5">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-3 w-10 rounded-full" />
          </div>
        ))}
      </div>

      <div className="mb-6 flex gap-2">
        {[64, 80, 96].map((width) => (
          <Skeleton key={width} className="h-11 rounded-full" style={{ width }} />
        ))}
      </div>

      <div className="space-y-6">
        {[0, 1].map((day) => (
          <div key={day}>
            <div className="mb-2 flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-xl" />
              <Skeleton className="h-4 w-32 rounded-full" />
            </div>
            <Card className="gap-0 py-0">
              <div className="space-y-3 px-4 py-3.5">
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-4 w-1/2 rounded-full" />
              </div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the full web gate**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run ci
```

Expected: lint, typecheck, all Vitest suites, `check:tokens`, `next build`, and `check:bundle` (the post-build grep proving the token appears nowhere in `.next/static`) all green. In particular `page.token-safety.test.ts` must pass, proving the sentinel token appears in no prop the page hands toward `MemberFeed`.

- [ ] **Step 7: Run the API gate one more time**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bin/ci
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed"
git add -A apps/web/src
git commit -m "BLO-1666: the member page renders the whole-house feed

Replaces the private shift list with the schedule feed, extends the token-safety
test to the new client tree, and removes shift-list.tsx and shift-card.tsx.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C5938aSaQ5TS4Hw2YGbWDY"
```

**Definition of done for Group D:** `npm run ci` in `apps/web` and `bin/ci` in `apps/api` are both green; no file in the tree references `shift-list`, `ShiftCard` or `coverTargetsFor`; `page.token-safety.test.ts` passes against the new tree.

---

# Group E: QA and evidence

Depends on Group D. Do not report the PR as ready before this group is complete.

### Task E1: manual QA on the seeded demo house

- [ ] **Step 1: Bring both apps up with real data**

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/api"
bin/rails db:prepare
bin/rails db:seed
bin/rails runner 'TopUpShiftWindowsJob.perform_now'
bin/rails runner 'puts Member.order(:name).map { |m| "#{m.name}: http://localhost:3001/s/#{m.access_token}" }'
bin/rails server
```

```bash
cd "${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/apps/web"
npm run dev
```

Use **Bass** for QA: Bass is on both rotas (kitchen and bins), so the feed, the YOU tags and the hand-off all have something to act on. Record Bass's URL; every screenshot in Task E2 uses that same one.

- [ ] **Step 2: Walk the checklist at 390px (phone)**

Check and record a pass/fail for each:

1. The greeting names Bass and the date is the group's today.
2. The next-shift card shows the correct next turn, with "Hand off" present when the shift is more than a day out and absent for a shift due today.
3. The "Then …" line names up to two further turns.
4. The people strip shows all four housemates with "You" on Bass, and scrolls horizontally.
5. Tapping Ciara filters the feed to Ciara's rows; tapping Ciara again clears it. `aria-pressed` flips (check in the accessibility inspector).
6. Chips: "Everyone", "Just me", "Bins out", "Kitchen deep clean". They wrap onto a second line and do not clip.
7. A person filter and a rota filter combine. "Everyone" clears only the rota half.
8. Week headings read "This week", "Next week", then a date range. Today's day row carries a "Today" tag.
9. Four weeks render; "Show more weeks" appears and reveals the rest with no network request (check the Network panel).
10. Hand off: the bottom sheet opens, candidates are grouped Free / Has a shift that week / Can't be texted, nothing is preselected, the primary button is disabled until a choice is made, and the footnote states that reminders move.
11. Completing a hand-off closes the sheet, updates the row in place to "{name} covering {assignee}", and toasts.
12. The handed-off row now offers "Take it back"; confirming restores it and toasts.
13. Filter to a rota with nothing upcoming to see "No shifts for this filter" and its "Show everyone" button.
14. Every tappable control is at least 44px tall.

- [ ] **Step 3: Walk the checklist at 1440px (desktop)**

15. Two columns: feed left, a 360px sidebar right.
16. The sidebar holds a "You" card with up to three turns and hand-off on the first, and a "People" card listing all four housemates with each one's next turn.
17. The people strip is **not** shown.
18. Clicking a row in the People card filters the feed; clicking it again clears.
19. Hand off opens a centred **Dialog**, not a bottom sheet, with identical content.
20. Resize to 1023px and confirm the layout falls back to the phone layout, strip included.

- [ ] **Step 4: Check the empty and edge states**

21. Deactivate a member (`bin/rails runner 'Member.find_by(name: "Raph").update!(active: false)'`) and reload: Raph is gone from the strip and the People card. Reactivate afterwards.
22. Opt a member out (`bin/rails runner 'Member.find_by(name: "Ciara").update!(sms_opted_out_at: Time.current)'`): Ciara is muted in the strip and appears under "Can't be texted", not selectable, in the hand-off sheet. Clear it afterwards.
23. Dark mode (the phone's own setting): the feed, the YOU highlight, the coins and the sheet all read correctly.

Report anything that fails rather than fixing it silently, then fix it and re-run the affected checks.

### Task E2: before/after screenshots and the gallery

- [ ] **Step 1: Capture the BEFORE pairs on `main`**

`main` and the branch must be captured with the **same member, the same data and the same viewport**. Use a second worktree so the seeded database is shared and untouched:

```bash
cd "${ROTA_REPO_ROOT}"
git worktree add .koh/BLO-1666-before main
cd .koh/BLO-1666-before/apps/web && npm install && npm run dev -- -p 3002
```

Point `APP_URL` at 3002 only if a link is generated; the page itself is reached directly at `http://localhost:3002/s/<Bass's token>`. The Rails API on port 3000 serves both.

Capture at exactly 390x844 and 1440x900:

| Pair | Route | State |
| --- | --- | --- |
| 1 | `/s/<token>` | Populated, 390px |
| 2 | `/s/<token>` | Populated, 1440px |
| 3 | `/s/<token>` | Hand-off open, 390px |
| 4 | `/s/<token>` | Hand-off open, 1440px |
| 5 | `/s/<token>` | No upcoming shifts for the viewer, 390px |

Pair 5's "before" is the old "You're all clear" empty state; its "after" is "Nothing on your plate" with the house's feed still below it. Produce it by clearing Bass's future shifts in a scratch rota, or by using Ciara (kitchen only) at a moment she has nothing.

Stage every PNG under `${ROTA_REPO_ROOT}/.koh/BLO-1666-member-dashboard-feed/tmp/screenshots/BLO-1666/`, named `NN-<viewport>-<state>-before.png` / `-after.png`. **Never `git add` this folder.** This repo is private, so `raw.githubusercontent` URLs render broken through GitHub's camo proxy and committing PNGs to a feature branch is not a workaround.

- [ ] **Step 2: Verify the captures before building anything from them**

A capture subagent opens each PNG and confirms the route, the viewport, the member and the state. The coordinator does **not** read the images; it builds the gallery from the returned paths and verdict. A screenshot of the wrong route or a logged-out redirect is worse than none.

- [ ] **Step 3: Publish the gallery Artifact**

The coordinator publishes the before/after pairs side by side as an Artifact, each pair labelled with its route and state and a one-line "what to look for". A filename table on its own is not acceptable.

- [ ] **Step 4: Open the PR and close the loop**

Open the PR with the gallery link at the top of a Screenshots section, then **republish the same Artifact URL** with the full clickable PR link added near the top. The linking is bidirectional and the artifact is not finished until the backlink is in.

- [ ] **Step 5: Watch CI to green**

```bash
gh pr checks --watch
```

- [ ] **Step 6: Clean up the before worktree**

```bash
cd "${ROTA_REPO_ROOT}"
git worktree remove .koh/BLO-1666-before
```

- [ ] **Step 7: Hand over without merging**

Report: the PR URL, the gallery URL, CI green, the QA checklist result, and "ready to merge, want me to?". **Do not merge.** Merging deploys to production.

**Definition of done for Group E:** every checklist item in E1 passes or is reported; five before/after pairs captured at matching viewport, member and data; gallery published and linked from the PR; PR links back from the gallery; `gh pr checks` green; nothing merged.

---

## Deviations from the spec, and why

Three places where the codebase does not match what the spec assumed. Each is resolved above; they are listed here so a reviewer can see the decision rather than discover it.

1. **Spec 4.1 says the shifts are "serialised with the existing `ShiftSerializer`".** They are not, and cannot be: `apps/api/app/serializers/shift_serializer.rb` carries no `rota_name`, no `can_assign_cover` and no `can_cancel_cover`. The shape the spec then lists field-by-field is the one produced by `Api::MemberBaseController#serialize_shift`, which the member path already shares between its list and its two cover actions. **Adjustment:** the new controller inherits `MemberBaseController` and calls `serialize_shift`, so the payload matches the `MemberShift` type the web app already has, byte for byte, with no new serializer.

2. **Spec 4.1 says "the group's active, non-draft rotas".** `Rota#draft?` is derived from the roster (`rota_positions.empty?`), never stored, so it cannot be a `WHERE` clause. **Adjustment:** `group.rotas.active.includes(:rota_positions).order(:name).reject(&:draft?)` — one extra query for the rosters, no N+1, and the shift query is then scoped to the surviving ids so a draft rota's leftover covered shifts cannot leak into the feed either.

3. **Spec 3.2 asks for a two-column desktop layout, but the member surface is capped at `max-w-lg` (512px).** `apps/web/src/app/(member)/layout.tsx` wraps everything in `<Container width="member">`, and a 360px sidebar plus a feed does not fit. **Adjustment (Task C1):** add one `feed` width to `Container` (`max-w-lg lg:max-w-5xl`) and point the member layout at it. The phone layout is byte-identical; only `lg` and up changes.

A fourth, smaller note: the spec's `shift-view.ts` is left undiscussed, but its `ShiftState` type currently lives in `shift-card.tsx`, which this work deletes. Task B4 moves the type into `shift-view.ts` and drops `coverTargetsFor`, whose job `cover-ranking.ts` now does properly.

---

## Self-review

**Spec coverage.** 3.1 header → D1; next-shift card → C4; people strip → C5; filter chips → C5; feed → B2 + C3 + C7; four weeks then "Show more weeks" → C7. 3.2 desktop → C1 + C5 + C7. 3.3 hand-off sheet → C6. 3.4 weeks and dates → B2 (tested for a Sunday today, a shared month, a straddled month and a year boundary). 3.5 empty and edge states → C4 (nothing on your plate), C7 (nothing on the rota yet, no shifts for this filter), C6 (no one else can cover yet), C3/C5 (truncation, initials via `initials()`). 4.1 endpoint → A1. 4.2 web client → B1, D1. 5 architecture → B2, B3, C2–C7. 6 security → A1's tenancy and authentication blocks, D1's token-safety test, `npm run ci`'s bundle grep. 7 testing → A1, B1–B3, D1, E1, E2. 8 rollout → E2 (one PR, held for review). 9 BLO-1667 hooks → noted in `cover-ranking.ts`'s header and in B2's `buildFeed`, which takes a whole schedule rather than a shift array so an `events` key can join it without reshaping a signature.

**Placeholders.** None. Every code step carries the code; every command is a real command verified against `package.json`, `config/ci.rb` and `.env.example`.

**Type consistency.** `FeedFilter`/`RotaFilter`/`WeekSection`/`DayRow` are defined once in B2 and consumed under those exact names in C3, C5 and C7. `CoverCandidate`/`CoverCandidates` are defined in B3 and consumed in C6. `AssignAction`/`CancelAction` are defined in C2 and consumed in C6 and C7 (they are the same signatures `shift-list.tsx` used, so `actions.ts` needs no change). `ShiftState`/`shiftStateFor` move in B4 and are imported in C3 and C4. `MemberScheduleResponse`/`ScheduleMember`/`RotaRef` are defined in B1 and used everywhere downstream. `runAction`/`useShiftUpdates` are defined in C2 and used in C6 and C7.
