import { siteOrigin } from "@/lib/site";

// The JSON-LD graph the homepage renders in a <script type="application/ld+json">.
//
// It is a module rather than a literal inside page.tsx for two reasons: the URLs
// have to be built from APP_URL (see lib/site.ts) rather than typed out, and the
// two things that would quietly cost us a rich result are testable here —
//
//   1. NO `offers`. Google's SoftwareApplication rich result treats an offer as a
//      price claim, and an inaccurate one is a manual-action risk. The product is
//      free today but no spec records that as a permanent price, so the block stays
//      out until pricing is decided. structured-data.test.ts asserts its absence so
//      a future copy-paste cannot slip one in.
//   2. NO `FAQPage`. There is no FAQ on the page, and marking up questions that a
//      visitor cannot see is exactly what the guidelines call out.
//
// Everything asserted below is something the page itself says and the product
// actually does: chores set up once, a text to whoever is next carrying their own
// link, hand-off in one tap, one pasted Google Calendar iCal link, away housemates
// ranked down. Nothing about two-way sync, replies by text, or apps to install.

export function buildStructuredData(origin = siteOrigin()): Record<string, unknown> {
  const home = `${origin}/`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#org`,
        name: "Rota Monster",
        url: home,
        logo: `${origin}/icon.svg`,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#site`,
        url: home,
        name: "Rota Monster",
        publisher: { "@id": `${origin}/#org` },
        inLanguage: "en-GB",
      },
      {
        "@type": "SoftwareApplication",
        name: "Rota Monster",
        url: home,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Web",
        description:
          "A chore rota app for shared houses. It texts whoever is up next and reads the " +
          "house calendar to know who is away.",
        featureList: [
          "Chore rota with turns",
          "SMS reminders with a personal link",
          "Hand a turn on in one tap",
          "House Google Calendar sync by iCal link",
          "Away housemates ranked down for hand-offs",
        ],
        publisher: { "@id": `${origin}/#org` },
      },
    ],
  };
}

/**
 * Serialise for injection into a <script> element.
 *
 * `</script>` inside a string value would end the element early, so every `<` is
 * escaped to its `<` form. That is still valid JSON and parses back to the
 * same string, which is why the escape happens after JSON.stringify rather than
 * by mangling the data.
 */
export function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
