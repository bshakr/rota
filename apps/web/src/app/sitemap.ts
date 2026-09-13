import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

// One entry, because there is one indexable page. Everything else is behind a
// session or a token and is disallowed in robots.ts.
//
// `lastModified` is a fixed date rather than `new Date()` on purpose: a sitemap
// that claims the page changed on every deploy teaches crawlers to ignore the
// field. Bump it when the homepage copy actually changes.
const HOMEPAGE_LAST_MODIFIED = new Date("2026-09-13");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl("/"),
      lastModified: HOMEPAGE_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
