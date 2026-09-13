import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

// One public page, and a lot of paths that should never reach an index.
//
// The disallow list is the actual route tree under src/app, not a guess:
//   (admin)/          dashboard, members, rotas, shifts, sms
//   (super-admin)/    super-admin and everything nested under it
//   (member)/s/       the SMS magic links. Off the proxy matcher entirely, so
//                     they answer 200 to anyone who has the token — which is
//                     exactly why a crawler must be told not to walk them.
//   h/                household entry pages. Public by design, one per house,
//                     and nobody searching the web should land on one.
//   setup, callback, auth/, styleguide
//
// The admin paths are 307s to WorkOS for a crawler, so nothing indexable is lost
// by disallowing them; what it buys is that the redirect chain is never crawled.
// `/s/` and `/h/` are the ones that matter: they answer with real content.
//
// A robots file is advisory, not access control. Every path here is protected by
// the AuthKit proxy or by an unguessable token; this only keeps them out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/members",
          "/rotas",
          "/shifts",
          "/sms",
          "/super-admin",
          "/setup",
          "/callback",
          "/auth/",
          "/s/",
          "/h/",
          "/styleguide",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
