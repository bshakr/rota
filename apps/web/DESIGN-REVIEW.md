# HouseRota web — design review & polish pass

Reviewed against the running app (dev server, real seeded data, light + dark, 375px and
1280px) and the full component source. The member page was exercised with a real
magic-link token; the WorkOS-gated admin screens were reviewed from component code and
via the shared primitives on `/styleguide`.

The foundation here is genuinely strong — the token system, the status idiom, the
touch-target discipline and the date handling are better than most production apps.
What was weak was not the system but a handful of places where **screens drifted from
their own styleguide**, and one big place where the accent was being spent carelessly.

## Design principles I applied

1. **Spend clay once per screen.** It's the only saturated colour; whatever wears it is
   what the screen is *about*. A repeated action can never be the thing a screen is about.
2. **Hierarchy answers the reader's first question.** A member's first question is
   "when am I up?" — so *when* must be legible before any sentence is read.
3. **One idiom per pattern.** Card lift (border + `shadow-xs`), the cover badge
   (`info` + swap icon), table headers (muted band) — each decided once, applied
   everywhere, styleguide kept in sync.
4. **Quiet by default, loud for consequence.** Badges whisper, alerts speak, only
   destructive buttons shout — and metadata (an SMS's *kind*) doesn't get to wear a badge.
5. **The shell never flinches.** Navigation must not blank the sidebar; loading states
   hold the page's real shape.
6. **375px is the primary surface.** Everything verified at phone width first.

---

## High

### H1. The member page sprayed the accent across every card — FIXED
**Screen:** `/s/[token]` · **Files:** `src/app/(member)/s/[token]/shift-list.tsx`

With real data (7 upcoming shifts), the page rendered seven full-width **solid clay**
"Ask someone to cover" buttons — seven alarms on a page meant to read like a note on
the fridge. Worse, it contradicted the styleguide's own member vocabulary, which
documents the cover CTA as an *outline* button. The cover flow is the escape hatch,
not the point of the page.

**Changed:** the CTA is now `variant="outline"`, with the question folded into the
label ("Can't make it? Ask someone to cover"), removing the extra microcopy line.
The passing-on variant reads "Can't make it after all? Ask someone else."

### H2. Shift cards had no urgency hierarchy — FIXED
**Screen:** `/s/[token]` · **Files:** `src/components/member/shift-card.tsx`

A shift due tomorrow and a shift 90 days out were visually identical; the relative day
("in 6 days") was a small inline word after the date. The one thing the card must say
at a glance — *when* — was the least visible thing on it.

**Changed:** the relative day is now a badge in the card's top-right (`CardAction`):
clay (`default`) when the shift is today/tomorrow, `secondary` otherwise. A soon card
also gets a clay hairline (`border-primary/40`) and one step more shadow, so the
next-up card leans forward while everything further out stays quiet. Since H1 removed
the solid buttons, the *only* clay on the page is now the thing that's imminent —
exactly what the accent is for. Styleguide member section updated to demo the state.

### H3. Admin navigation blanked the whole shell — FIXED
**Screens:** all `(admin)` routes · **File added:** `src/app/(admin)/loading.tsx`

Every admin page is `force-dynamic`, and the only loading boundary above them was the
app-root `loading.tsx` — which sits *above* the admin layout. Result: every sidebar
click tore down the sidebar and showed a bare full-screen skeleton, making the app feel
like it was doing a full reload on every navigation.

**Changed:** added an `(admin)/loading.tsx` inside the shell — a PageHeader-shaped
skeleton plus card-shaped blocks. The sidebar and mobile header now hold still during
navigation. (Members keeps its more specific table-shaped skeleton.)

### H4. Tables looked like default shadcn: no header band, cramped cells — FIXED
**Screens:** members, SMS log, shifts, styleguide · **File:** `src/components/ui/table.tsx`

The header row was indistinguishable from data rows (same size, same weight, same
background), and 8px horizontal cell padding crowded the rounded card edge. The
styleguide even documents `--muted` as "a table header" — but no table used it.

**Changed:** `TableHeader` gets the documented `bg-muted/50` band; `TableHead` drops to
`text-xs text-muted-foreground` (labels are wayfinding, not data); cells get
`px-3 py-2.5` with `pl-4/pr-4` at the first/last column so content aligns with the
card's own padding. All four table screens inherit it.

### H5. Rota create/edit content was centred under a left-aligned header — FIXED
**Screens:** `/rotas/new`, `/rotas/[id]` · **Files:**
`_components/rota-editor.tsx`, `_components/rota-create-form.tsx`

`PageHeader` spans the full `max-w-5xl` container while the editor column was
`max-w-2xl mx-auto` — two different left edges, so the page read as two misaligned
halves. The create form also rendered its inputs bare on the page background while the
edit screen wraps the *same form* in a "Details" card.

**Changed:** dropped `mx-auto` (one shared left edge), and wrapped the create form in
the same `Details` card as the edit screen.

---

## Medium

### M1. Card-idiom drift on hand-rolled table wrappers — FIXED
**Files:** `members-screen.tsx`, `sms/page.tsx`, `shifts-board.tsx`, `styleguide/_components/gallery.tsx`
The card idiom is "bg-card + hairline + `shadow-xs`", but the table wrappers skipped the
shadow, so tables sat subtly flatter than every other panel. Added `shadow-xs`.

### M2. Dialog titles at body-text size — FIXED
**File:** `src/components/ui/dialog.tsx`
"Remove Dave from the house?" rendered at `text-base font-medium` — a decision title
with no more presence than a card label. Now `text-lg font-semibold leading-snug
text-balance` (wraps safely at 375px).

### M3. The cover badge had three spellings — FIXED
**Files:** `rotas/_components/upcoming-shifts.tsx`, `styleguide/_components/gallery.tsx`
Dashboard and shifts board used `info` + swap icon; the rota editor's upcoming list and
the styleguide's table demo used a bare `secondary` badge. One idiom now: `info` +
`ArrowRightLeft`, everywhere a cover is shown.

### M4. SMS log: a pill in every row saying nothing — FIXED
**File:** `sms/page.tsx`
Every row wore a `secondary` "Reminder" badge. Kind is metadata, and the status idiom
reserves badges for status — 100 rows meant 100 pills competing with the actual
delivery-status badge. Now plain text with the timing detail beneath.

### M5. Root page shipped stale scaffolding copy — FIXED
**File:** `src/app/page.tsx`
"Shell and design system only. The screens themselves land in BLO-1051 through
BLO-1055" — internal ticket copy on a public page, months after those screens landed.
Rewritten as a real signpost (dashboard first), with a one-line product description.

### M6. The message preview didn't look like a message — FIXED
**File:** `rotas/_components/message-preview.tsx`
The live SMS preview rendered as a bordered config box. It now renders as a received
text bubble (rounded, one squared corner, capped width) — the admin reads it as the
thing a member will actually receive.

### M7. Inactive members looked identical to active ones — FIXED
**File:** `members/members-screen.tsx`
Only the badge changed. The whole row/card now dims (`opacity-60`), the same recede cue
the member page uses for handed-off shifts; the badge then names what the dimming says.

### M8. Small consistency fixes — FIXED
- `EmptyState` icon was `size-5` while the styleguide documents `size-6` as the
  empty-state glyph; now `size-6` in a `size-12` circle (`empty-state.tsx`).
- Member greeting subtitle bumped `text-sm → text-base` — it's the page's one sentence
  of context, read at arm's length (`(member)/s/[token]/page.tsx`).
- Shifts board rota headings now carry a muted "`N` upcoming" count
  (`shifts-board.tsx`).
- Roster drag-rows get `shadow-xs` — a hint of pick-up-able lift the grip icon alone
  didn't carry (`roster-editor.tsx`).

---

## Low / recommended, not done

### L1. SMS log: every message renders an always-open detail row
**File:** `sms/page.tsx`
Each message is two table rows, the second always showing the full mono body + Twilio
metadata. At 100 messages that's a wall of near-identical mono text; failures (the rows
that deserve detail) drown in it. **Recommend** collapsing the detail row behind a
per-row expand (chevron; failed rows expanded by default). Not done: it converts a
server-rendered table into an interactive client surface late in a multi-agent cycle —
worth its own reviewed change, not a drive-by.

### L2. Sidebar active item spends clay
**File:** `admin-shell.tsx`
The active nav item is solid clay, which slightly competes with each screen's primary
CTA. A quieter active state (sidebar-accent fill, clay icon) would concentrate the
accent further. Not done: `--sidebar-primary` exists precisely for this and the current
look is a documented, deliberate choice — a taste call for the owner, not drift.

### L3. Member page repetition with a single rota
Seven "Bins" cards are inherently repetitive; H1/H2 calm them, but if lists grow, group
by month or fade the CTA on far-future cards. Data-shaped problem; revisit with real
usage.

### L4. Group settings lives on the dashboard
Fine at this scale (and the timezone warning deep-links to it), but it will eventually
deserve its own route. Out of scope — routing changes were off-limits for this pass.

### L5. Admin screens not visually verified
WorkOS blocks headless login; dashboard/members/rotas/shifts/SMS were reviewed from
code and via the styleguide's shared primitives. A quick human pass over `/dashboard`
in both themes is recommended after merge.

---

## Verification

- `/styleguide`, `/`, `/s/<real-token>`, `/s/demo-token` (invalid-link path) and the
  route-level loading states screenshotted at 375px and 1280px, light **and** dark.
- `npm run ci` (lint, typecheck, 98 tests, token contrast gate, build, bundle check)
  green.
