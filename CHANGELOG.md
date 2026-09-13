# Changelog

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
