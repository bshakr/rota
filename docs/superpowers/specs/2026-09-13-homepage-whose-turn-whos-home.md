# Homepage: "Whose turn? Who's home?" (calendar sync on the marketing page)

Status: direction C chosen by Bassem on 2026-09-13, out of four explorations.
Canvas (chosen board on page 1, the other three on page 2):
https://claude.ai/code/artifact/96ed3593-3fb9-434d-a484-95c3c42ca487
Builds on: `2026-09-12-rota-monster-soft-clay-design.md` (brand, copy rules) and
`2026-09-13-house-calendar-sync-design.md` (BLO-1667, what the sync does).

## 1. Why

The landing page pitched one idea (whose turn it is) and listed three features with no
depth. House calendar sync (BLO-1667) changes what the product is: it now also knows
who is in the house. The page should say so, and explain the benefits a visitor
actually doubts: nothing for housemates to install, set-up is two minutes, hand-offs
land with somebody who is home.

## 2. The four directions considered

| | Direction | Axis | Why not |
|---|---|---|---|
| A | Grow the page | structure: same hero, four moves, how it works, FAQ | calendar reads as one more feature |
| B | One week in the house | narrative: five beats down a spine | longest page; calendar two screens down |
| **C** | **Whose turn, and who's home** | **the pitch: calendar is half the product** | **chosen** |
| D | Through Ciara's phone | point of view: the member's phone in the hero | admin's set-up story gets little room |

C's known tradeoff, accepted: the hero carries two ideas, and a house with no shared
Google Calendar may read the page as not for them. The "Nothing to install" strip and
the "optional" wording on the calendar step are there to soften that.

## 3. The page (`apps/web/src/app/_components/landing.tsx`)

1. Header: wordmark, theme toggle, ghost "Sign in". Unchanged.
2. Hero on the lavender pane. Badge "Gently nags. Never bites." Headline
   "Whose turn? Who's home? Sorted." Sub: "Set the chores up once and Rota Monster
   texts whoever's up next. Paste the house calendar link and it knows who's away, so
   a turn never lands on somebody who's in France." CTA "Set up your house", note
   "Two minutes, promise." Vignette: a member feed card with a chore row, an away row
   ("Ciara away, until Sun 21 Sep") and an event row ("House dinner, Thu 19:00").
3. Intro: "Two things every house argues about." with one line of sub.
4. Pair: "The rota / Whose turn." (white card: set it once, texts not nags, swaps sort
   themselves; vignette: the SMS to Ciara) and "The calendar / Who's home." (lavender
   pane: paste one link, events in everyone's feed, knows who's away; vignette: the
   week strip where "Ciara in France" becomes the away row).
5. "They work together": one wide card with the hand-off list, Eliza first, Ciara
   marked away and moved down.
6. "Nothing to install": three quiet lines (housemates get a text with their own link;
   the admin pastes one link once; the calendar refreshes itself every hour).
7. Closing CTA on the lavender pane, footer.

One primary action, repeated: "Set up your house" to `/dashboard` as a plain anchor
(the proxy starts sign-in; see the comment in the component).

## 4. Claims the page may make

Only what BLO-1667 ships: paste the Google Calendar secret iCal link once; upcoming
house events show in every housemate's feed; away dates are read from event titles
the way the house writes them; away housemates are shown as away and moved down the
hand-off list; refreshes hourly. One quiet line that titles are read "the way a
housemate would". Not promised: two-way sync, Google sign-in, Apple Calendar,
per-event editing.

## 5. Copy rules (from the brand spec)

No em or en dashes anywhere user-visible. One emoji, only in the example SMS. No
"seamless" family. Cast Bass, Eliza, Raph, Ciara; Ciara gets the text; British spelling.

## 6. Acceptance

`npm run ci` green in `apps/web`; a grep for dashes in `landing.tsx` returns only
code comments; nothing overflows at 390px; both themes pass `check:tokens`; before and
after screenshots of `/` at 1440 and 390 in both themes, published as a gallery and
linked from the PR.
