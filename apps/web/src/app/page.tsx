import { withAuth } from "@workos-inc/authkit-nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { pageTitle, SITE_DESCRIPTION, SITE_TAGLINE, SITE_TITLE, siteOrigin } from "@/lib/site";

import { Landing } from "./_components/landing";
import { buildStructuredData, toJsonLd } from "./_components/structured-data";

// The only page a search engine ever sees, so it is the only page with real
// metadata. Resolved against the layout's `metadataBase`, which is why the
// canonical and og:url below are relative.
//
// The title is the searched phrase plus the brand: "The chore rota that texts
// your housemates · Rota Monster", 56 characters, inside what Google shows.
//
// It is built with `pageTitle()` and set as `absolute` rather than left to the
// layout's `title.template`, because the template would not fire. Next applies a
// segment's template to its CHILDREN, and `app/page.tsx` is the root layout's own
// segment; a plain string here ships the page with the brand missing. Verified
// against the rendered <title>, not assumed.
//
// `openGraph.title` deliberately differs from the <title>. A search result is
// read as a link and wants the keyword; a card pasted into a group chat is read
// as a sentence, and the sentence is the line the page itself leads with.
export const metadata: Metadata = {
  title: { absolute: pageTitle(SITE_TITLE) },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "Rota Monster",
    url: "/",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
};

// `/` is public (the proxy lists it in unauthenticatedPaths): a signed-in
// admin goes straight to their dashboard; everyone else gets the landing
// page. Its CTA links to /dashboard, a proxy-protected path, so sign-in
// starts through the EXISTING mechanism: the proxy performs the WorkOS
// redirect (middleware may write the PKCE cookie; a page render may not,
// which is why the CTA is not a getSignInUrl() href).
export default async function Home() {
  const { user } = await withAuth();
  if (user) redirect("/dashboard");

  return (
    <>
      {/*
        The JSON-LD graph. `dangerouslySetInnerHTML` is the only way to put raw
        JSON in a script element — React would otherwise escape it into HTML
        entities that no parser reads — and it is safe here because the payload
        is a literal built in this repo, not user input, and `toJsonLd` escapes
        every `<` so nothing in it can close the element. See structured-data.ts
        for why there is no `offers` block.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toJsonLd(buildStructuredData(siteOrigin())) }}
      />
      <Landing />
    </>
  );
}
