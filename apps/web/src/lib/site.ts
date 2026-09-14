// The one place that answers "what is this site's public address?".
//
// Four things need it and they must not disagree: `metadataBase` (which resolves
// every relative canonical, og:url and og:image into the absolute URL crawlers
// require), robots.txt's `Sitemap:` line, sitemap.xml's entries, and the JSON-LD
// @id graph. Hardcoding rota.monster in four files is how three of them end up
// pointing at production from a preview deploy.
//
// APP_URL is the monorepo's existing name for it (root .env, read by next.config.ts
// through @next/env, and by Rails). It is SERVER-only and that is fine: everything
// here runs during metadata generation or in a Server Component, never in the browser.
//
// The fallback is not decoration. CI has no .env (it is gitignored) and still runs
// `next build`, which prerenders robots.txt, sitemap.xml and the OG image. Without a
// literal default, `new URL(undefined)` throws and the build goes red.
const FALLBACK_SITE_ORIGIN = "https://rota.monster";

/** The site's origin with no trailing slash, e.g. `https://rota.monster`. */
export function siteOrigin(): string {
  return (process.env.APP_URL ?? FALLBACK_SITE_ORIGIN).replace(/\/+$/, "");
}

/** An absolute URL on this site. `siteUrl()` is the homepage, trailing slash included. */
export function siteUrl(path = "/"): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}

// The site-facing copy. One home for it because four surfaces have to agree:
// the <title>, the meta description, the Open Graph card, and the image that
// card renders. Four copies is how the OG card ends up a release behind.

/** The brand, spelled once. */
export const SITE_NAME = "Rota Monster";

/**
 * The suffix every page title carries. The root layout hands this to Next as
 * `title.template`, which covers every route BELOW it.
 *
 * `/` is not below it. `app/page.tsx` is the root layout's OWN segment, and Next
 * deliberately does not apply a segment's template to itself — set a plain string
 * there and the page ships titled "The chore rota that texts your housemates"
 * with the brand missing. So the homepage applies the same template by hand
 * through `pageTitle()`, from this one constant, and site.test.ts asserts the
 * layout is still handing Next the identical string.
 */
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

/** A page title with the brand suffix applied. */
export function pageTitle(title: string): string {
  return TITLE_TEMPLATE.replace("%s", title);
}

/**
 * The phrase the whole site leads with: the page's h1, the search result, and
 * the Open Graph and Twitter card titles. With the brand suffix it is 56
 * characters. Decided by Bass on 2026-09-13: the headline has to be the thing
 * people search for, not the brand line.
 */
export const SITE_TITLE = "The chore rota that texts your housemates";

/** The meta and Open Graph description. 157 characters, inside Google's ~160 cut. */
export const SITE_DESCRIPTION =
  "Rota Monster is a chore rota app for shared houses. Set the chores up once and it texts " +
  "whoever is up next. Paste one calendar link and it knows who is away.";

/**
 * The brand line. It leads the hero paragraph under the h1, closes the footer,
 * and sits under the headline on the Open Graph card. A curly apostrophe, so
 * that every surface renders the same string the page's own typography uses.
 */
export const SITE_TAGLINE = "Whose turn? Who’s home? Sorted.";

/**
 * Where a visitor writes to. The footer's contact link uses it, and the privacy
 * and terms pages name it as the contact point, so it lives here rather than
 * being typed into three files.
 *
 * The studio mailbox rather than one on this domain, because hello@rota.monster
 * does not exist. Confirmed by Bass on 2026-09-13. It matters that this one is
 * real: the privacy page offers it as the route for a UK GDPR request, and those
 * carry a statutory one month clock.
 */
export const CONTACT_EMAIL = "hello@bloombase.studio";

/**
 * Who made it. The footer credits the studio rather than a person, and links
 * out. Decided by Bass on 2026-09-13.
 */
export const MAKER_NAME = "bloombase.studio";
export const MAKER_URL = "https://bloombase.studio";
