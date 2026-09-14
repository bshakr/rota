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

## 7. Revisions 2026-09-13 (review round)

An SEO, a content-editor and a growth review of the shipped page were reconciled
into four waves. This is wave 1, truth and copy only: no new sections, no product
changes. What changed in `landing.tsx` and why.

- The h1 is now "The chore rota that texts your housemates", and "Whose turn? Who's
  home? Sorted." leads the paragraph under it. Bass, 2026-09-13: the headline has to
  be the phrase people search for. The brand line said nothing a stranger could act
  on and carried no rankable words, and section 3's three stacked spans were built
  around it; the h1 now wraps on its own with `text-balance`. The string comes from
  `SITE_TITLE` in `apps/web/src/lib/site.ts`, so the h1, the `<title>`, the Open
  Graph and Twitter card titles and the card image cannot drift apart. The card image
  swaps its two lines to match, and the footer keeps the brand line.
- Hero paragraph frames the calendar as a question ("Keep a house calendar?"). The
  page never said the calendar is optional, which is the accepted risk in section 2
  left unsoftened. The audience word moved into the `<title>` and the meta
  description rather than the hero, once the h1 took the keyword.
- Both CTA notes say "Free", and the hero note says the button opens a sign-in
  ("Free. Sign in with email, two minutes, promise."). The product is free today and
  the click hit a WorkOS redirect with neither fact stated.
- The example SMS moves Ciara's turn to Sat 27 Sep. The page's own feed says today
  is Sat 20 Sep, Ciara is away until Sun 21 and Sat 20 is Raph's turn, so texting
  Ciara for "this Saturday" was the exact mistake the product promises never to make.
- "an hour later at most" becomes "within a couple of hours", matching the sync
  design's section 3: Google caches the feed for one to two hours.
- Panel headings became benefits rather than features: "Nobody has to nag" (which
  also stops contradicting the "Gently nags" badge), "Can't do it? Hand it on",
  "Everybody sees what's on".
- The calendar panel's first line ends "No shared calendar? Skip it. The rota works
  on its own", and the closing body makes the link conditional.
- The reassurance strip stopped repeating the panels and now answers cost, the
  privacy of the secret link, and what an admin has to press. Its second line
  ("reads event titles and dates, nothing else") is true of the parser, which reads
  only SUMMARY, UID, DTSTART, DTEND, RRULE, RECURRENCE-ID, STATUS and the two X-WR-
  headers, and of the classifier, which sends the title and the dates. The strip
  also gained a quiet h2 "Nothing to install" so its three lines are not orphaned in
  the document outline.
- The closing heading is "Set it up tonight. Argue about something else.", so
  "Sorted." in the h1 and the footer are the only uses of "sort" left on the page.
- "Feed" is gone from visitor-facing copy; the member surface is called a page.
- Both wordmarks link to `/` with an "Rota Monster home" label.
- The hero text column lost `animate-pop`: it started the h1 at opacity 0 for 0.45s
  and the h1 is the largest contentful paint. The vignette beside it still pops.

## 8. Revisions 2026-09-13 (trust and objections, wave 3)

Four sections added to the page, and two pages added to the site. The page had been
selling without closing: it never said what the next ten minutes look like, never
answered what it costs or what it does with the calendar, and its footer offered no
privacy, no terms and no way to reach anybody.

- **"How it works", after the pair.** Three numbered steps: add the housemates and
  their numbers, add the chores and who takes turns, paste the calendar link if the
  house has one. It closes on "Rota Monster does the texting from here." Numbered
  because it is a real sequence, and on the bare paper rather than in a pane, so the
  page does not become a stack of boxes. Step three says "if you have one", which is
  the third place the calendar is made optional.
- **"What a housemate gets", after the hand-off card.** The page talks to the admin
  throughout, because the admin is the only person who ever visits it. This card
  answers the question the admin gets asked back: no app, a text with a link to your
  own page, nothing to download and no password to forget.
- **"Questions", before the closing panel.** The six merged questions from the review
  round, answered inside what the product does today. No STOP handling, no reply by
  text and no escalation is claimed, because none of those is built. The component
  also emits a FAQPage JSON-LD graph built from the same array as the visible copy,
  so the structured data cannot drift from the page. One entry departs from the merged
  copy: "We don't use Google Calendar." became "What if we don't use Google Calendar?",
  answer unchanged. That string is emitted as a `Question` name in the graph, where a
  statement is wrong, and it was the only one of the six not phrased as a question.
- **A shared site footer** replaces the landing page's inline one. Wordmark, the
  tagline from `SITE_TAGLINE`, privacy, terms, a contact address and a "Made by
  bloombase.studio" link. The legal pages use the same component at the prose
  measure, so their wordmark, document and footer sit on one left edge.
- **`/privacy` and `/terms`**, the first legal documents the app has had, written as
  short plain documents for a free product run by one person. Every factual claim was
  checked against the code: the calendar disconnect deletes the link and every event,
  removing a housemate stops their link but keeps their name and number, nothing is
  on a deletion timer, there is no self-serve house delete, descriptions and guests
  are never read out of the feed, and the classifier request carries the housemates'
  names as well as the event titles. Where the code does nothing, the pages say so.
  Both paths are in the proxy's `unauthenticatedPaths`.

One spacing rule came out of the QA pass and is worth keeping: a section's boundary
gaps have to beat its internal ones, or the block reads as inserted rather than as
part of the page. "How it works" first shipped with 48/34/37/30px inside it and only
26px under its closing caption, so the caption read as a label on the hand-off card
below. It now sits at 64px above and 78px below, against 28 and 32 inside. The
housemate card went from under 18px of clear space under the hand-off card to 41px,
which is a beat rather than a footnote.

The footer speaks one link vocabulary: privacy, terms, contact and the maker credit
are all underlined at rest. The credit is quiet by colour, not by decoration, because
underlining only the credit would have left it louder than the two legal links above
it. The wordmark stays undecorated, being a logo rather than a text link.

Not built, by Bass's decision: the founder note. It is out of scope rather than
pending.

The contact address is `hello@bloombase.studio`, one constant in
`apps/web/src/lib/site.ts` feeding the footer and both legal pages. It is the studio
mailbox rather than one on this domain, because hello@rota.monster does not exist
(Bass, 2026-09-13). Note that `apps/api/app/mailers/application_mailer.rb` still
defaults `from:` to that non-existent address; it is dormant, with no subclass and
nothing delivering, so it is a separate ticket rather than part of this wave.

Open, for Bass rather than for code: no postal address is given for the operator, no
hosting region is recorded anywhere in the repo, and neither document has been read by
a lawyer.

Wave 4 (the demo house and analytics) is tracked in the review round, not here.

## 9. Revisions 2026-09-14 (hero note correction)

Bass confirmed on 2026-09-14 that AuthKit offers email, Google, Microsoft, GitHub and
Apple; the hero note now says email or Google.
