# Changelog

## 2026-09-14

### Added

- A text to the operator when a brand new admin signs up: one SMS, a minute after the user row first
  appears, naming who signed up, their email, the house they made and how many admins that makes.
  The minute's wait is what makes it worth reading, because the sign-in callback fills in the email
  and name just after the row is created and the house arrives on the next request. It goes to
  `SIGNUP_ALERT_PHONE`, a new and optional env var: unset means nothing is enqueued at all, and a
  value that is set is normalised to E.164 at boot and refuses to boot if it does not parse. The
  alert writes no `sms_messages` row, so the spend page does not count its roughly 4p. (#67)

- `GET /api/shifts`: every upcoming turn of the house's running rotas in one request, ordered by
  due date then rota name, the same order the member feed uses, and each turn carries the
  `rota_name` it belongs to so a caller never has to look the name up in a second answer. The
  per-rota `GET /api/rotas/:rota_id/shifts` is unchanged and the rota screen still reads it.
- Soft Clay for the WorkOS sign-in page: `docs/authkit/` holds the custom CSS to paste into the
  AuthKit branding editor, the dashboard recipe (wordmark, colours, Outfit, dark mode) and a
  Playwright script that previews the CSS against the live hosted page. No app code changes; the
  page is styled in the WorkOS dashboard. (#60)

### Changed

- The admin dashboard loads in two round trips and streams its shell. It used to fetch in four
  rounds, one of them a request per running rota, so a busier house waited longer, and nothing at
  all painted until the last answer arrived. The nav, the wordmark and the theme toggle now paint
  on the first flush, before the check for a paused house has been answered at all. That check is
  the first round trip; the house's rotas, its people, every upcoming turn, the failed texts and
  the calendar preview are the second, all in flight together, and a dashboard-shaped skeleton
  holds the page while they land. (#66)
- Dropped the root `VERSION` file. Nothing read it, and it conflicted on every parallel pull
  request. (#55)
- The mailer's default sender moved from `hello@rota.monster`, a domain that does not exist, to
  `hello@bloombase.studio`, the same contact address the web app already uses. (#55)
- The homepage's hero note says sign-in is by email or Google; the sign-in screen offers both and
  more (#58).
- The super admin spend report is in **GBP**, everywhere. The business is in the UK and Twilio bills
  the account in pounds, so the old USD-only sum showed £0.00 settled next to six real charges.
  Twilio rows billed in pounds are now the settled figure and anything else keeps its own
  unconverted line. Anthropic still bills in dollars and is converted at `SPEND_GBP_PER_USD`, a
  configured rate published in the payload so the page can print what it converted at; with no rate
  set, Claude is reported in dollars, its pound figure is null rather than zero, and every total
  says in words that it leaves Claude out. The per-segment estimate is measured from the mean of the
  last ninety days of settled texts once twenty of them exist, and falls back to a configured
  `SMS_ESTIMATED_SEGMENT_COST_GBP` (default 0.04) before that. Env renames:
  `FIXED_MONTHLY_COST_USD` → `FIXED_MONTHLY_COST_GBP`, `SMS_ESTIMATED_SEGMENT_COST_USD` →
  `SMS_ESTIMATED_SEGMENT_COST_GBP`. Nothing about what houses are charged changes.

## [0.0.3.1] - 2026-09-13

### Added

- In-house analytics: ten named funnel events stored in an `analytics_events` table, with no third
  party, no SDK, no script in the page and no analytics cookie. The six that belong to a house are
  written by Rails in-process and fire only the first time each can be true; the four that happen
  before a house exists are posted to the app's own `/api/analytics` and forwarded to Rails behind
  `ANALYTICS_SHARED_SECRET`. A browser can send only three of the ten, so the numbers that matter
  cannot be forged. The landing page fires its view on mount and names which of its three calls
  to action was pressed, through a client wrapper that renders the same plain anchor as before
  and cannot delay the navigation.
- First-touch attribution: the UTM parameters and `ref` a visitor lands on `/` with are kept in an
  httpOnly functional cookie across the WorkOS round trip and stored once on the house at `/setup`
  (`groups.first_touch`), so a house can be traced back to what brought it.
- `members.first_opened_at`, the moment a housemate's magic link first worked, which is what makes
  "houses with a text delivered and two housemates opened within seven days" computable.
- `analytics:funnel`, `analytics:sources` and `analytics:prune` rake tasks, the last deleting
  anonymous events after ninety days. Runbook: docs/runbooks/analytics-funnel.md.

## [0.0.2.6] - 2026-09-14

### Added

- The homepage answers its objections. "How it works" lays out the three steps after
  the pair, a "What a housemate gets" card follows the hand-off card, and a six
  question "Questions" block sits before the closing panel. The questions block also
  emits a FAQPage JSON-LD graph built from the same array as the visible copy, so the
  structured data cannot drift from the page.
- Public /privacy and /terms pages, the first legal documents the app has had. They
  describe what the code actually does: disconnecting the calendar deletes the link
  and every event it brought, removing a housemate stops their link but keeps their
  name and number, nothing is deleted on a timer, there is no self-serve house delete,
  and Twilio, WorkOS and Anthropic each see a defined slice. Both paths are in the
  AuthKit proxy's unauthenticatedPaths so a logged-out visitor can read them.

### Changed

- The landing page's inline footer becomes a shared site footer, carrying the
  wordmark, the tagline, privacy, terms, a contact address and a "Made by
  bloombase.studio" link. The legal pages use the same footer at the prose measure.
  Design record: docs/superpowers/specs/2026-09-13-homepage-whose-turn-whos-home.md
  section 8.

## [0.0.2.5] - 2026-09-13

### Added

- The member page now ends with one quiet line, "Got a friend who needs a rota?
  Share rota.monster with them.", where the domain links to the homepage with
  `?ref=member`. A housemate is added by somebody else and only ever sees their own
  rota, so that page had no route back to the site and no name to pass on.

||||||| parent of 6b5f386 (v0.0.2.4 feat: homepage how it works, questions, housemate card, footer, privacy and terms)
## [0.0.2.3] - 2026-09-13

### Changed

- The homepage headline is now the phrase people search for, "The chore rota that
  texts your housemates", and "Whose turn? Who's home? Sorted." leads the paragraph
  under it. The Open Graph and Twitter card titles and the card image follow the
  same order.
- Homepage copy round one after the SEO, content and growth reviews: the hero makes
  the house calendar optional, both calls to action say the product is free, the
  example text message moves to a Saturday Ciara is actually home, "an hour later at
  most" becomes "within a couple of hours" to match the sync, the panel headings and
  reassurance strip stop repeating each other, and the wordmarks link home. The hero
  text column lost its entrance animation so the headline paints straight away.
  Design record: docs/superpowers/specs/2026-09-13-homepage-whose-turn-whos-home.md
  section 7.

## [0.0.2.2] - 2026-09-13

### Added

- Search and share metadata for the homepage. It now carries a real title ("The
  chore rota that texts your housemates · Rota Monster"), a description, a
  canonical URL, Open Graph and Twitter card tags, and a JSON-LD graph
  (Organization, WebSite, SoftwareApplication) with no price claim in it.
- An Open Graph card image at /opengraph-image, generated at build time in the
  Soft Clay look: lavender paper, a white pane, the wordmark, and the line the
  page leads with. It is served without a session, so link scrapers can fetch it.
- robots.txt and sitemap.xml. Everything behind a session or an SMS token is
  disallowed, including the household entry and member magic-link paths; the
  homepage is the one entry in the sitemap.

### Changed

- The document language is en-GB, matching the copy.
- Space Mono is no longer preloaded. It is only used on admin surfaces, and
  preloading it cost the landing page a font file it never renders.

## [0.0.2.0] - 2026-09-13

### Changed

- Rebuilt the marketing homepage around "Whose turn? Who's home? Sorted.": the hero
  shows a member feed with chore, away and event rows, a rota/calendar panel pair
  explains the house calendar sync (BLO-1667), a hand-off card shows an away
  housemate moved down the list, and a reassurance strip covers what nobody has to
  install. Design record: docs/superpowers/specs/2026-09-13-homepage-whose-turn-whos-home.md.

## [0.0.1.0] - 2026-09-13

### Changed

- Completed the Rota Monster rename across application identifiers, test fixtures,
  and documentation. Existing database names and connection settings are preserved.
