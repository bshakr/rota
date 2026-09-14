# Changelog

## 2026-09-14

### Added

- Soft Clay for the WorkOS sign-in page: `docs/authkit/` holds the custom CSS to paste into the
  AuthKit branding editor, the dashboard recipe (wordmark, colours, Outfit, dark mode) and a
  Playwright script that previews the CSS against the live hosted page. No app code changes; the
  page is styled in the WorkOS dashboard. (#60)

### Changed

- Dropped the root `VERSION` file. Nothing read it, and it conflicted on every parallel pull
  request. (#55)
- The mailer's default sender moved from `hello@rota.monster`, a domain that does not exist, to
  `hello@bloombase.studio`, the same contact address the web app already uses. (#55)

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
