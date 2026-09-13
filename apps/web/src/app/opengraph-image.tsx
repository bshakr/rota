import { ImageResponse } from "next/og";

import { SITE_TAGLINE, SITE_TITLE } from "@/lib/site";

// The card every link to rota.monster renders as, in Slack, WhatsApp, iMessage,
// Facebook and X. Soft Clay, held to the four things the system is: lavender
// paper, a white pane with a 32px radius, plum ink, one grape accent.
//
// Note it lives at the app root, so every route inherits it. Only `/` is ever
// shared, but a signed-in page pasted into a group chat getting the brand card
// instead of nothing is the right default.
//
// The proxy would otherwise eat this: `/opengraph-image` has no dot, so the
// AuthKit matcher covers it and an anonymous scraper would be 307'd to WorkOS.
// It is listed in `unauthenticatedPaths` in src/proxy.ts, and
// proxy-matcher.test.ts asserts that entry stays there.

export const alt =
  "Rota Monster. Whose turn? Who's home? Sorted. The chore rota that texts your housemates.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* eslint-disable no-restricted-syntax --
   Raw hex, deliberately and only here. This image is rendered by satori, not by a
   browser: there is no stylesheet, no Tailwind, no custom properties, so a
   semantic token cannot be resolved. The values are the Soft Clay pigments from
   globals.css and must be kept in step with them by hand — the same bargain
   `themeColor` in layout.tsx already makes. There is no dark cut: an OG card is
   an image, and an image does not invert. */
const PAPER = "#F5F1FF"; // --lavender-100, the page
const PANE = "#FFFFFF"; // --card by day
const INK = "#34244D"; // --plum-800, foreground
const MUTED = "#6F6089"; // --plum-400, muted foreground
const GRAPE = "#6334CB"; // --grape-500, the action colour
const SHADOW = "0 24px 60px rgba(52, 36, 77, 0.14)"; // the long soft plum drop
/* eslint-enable no-restricted-syntax */

// satori needs a real font file: TTF, OTF or WOFF, never WOFF2, and it cannot read
// what `next/font` produces. Google Fonts serves TTF to a user agent old enough not
// to claim WOFF2 support, which is what this pretends to be.
//
// This runs at BUILD time, not per request: the route takes no params and touches no
// dynamic API, so Next prerenders the PNG once and serves a static file afterwards.
// The build already fetches these same two families through `next/font/google` in
// layout.tsx, so this adds no dependency the build did not already have. If the fetch
// fails anyway, `null` falls through to satori's built-in font and the build stays
// green with a plainer card rather than going red.
const LEGACY_UA = "Mozilla/5.0 (Windows NT 6.1; WOW64)";

async function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssResponse = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`,
      { headers: { "User-Agent": LEGACY_UA } },
    );
    if (!cssResponse.ok) return null;

    const source = (await cssResponse.text()).match(
      /src:\s*url\((https:\/\/[^)]+)\)\s*format\('truetype'\)/,
    )?.[1];
    if (!source) return null;

    const fontResponse = await fetch(source);
    return fontResponse.ok ? await fontResponse.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [fredoka, outfit] = await Promise.all([
    googleFont("Fredoka", 600),
    googleFont("Outfit", 400),
  ]);

  const fonts = [
    fredoka
      ? { name: "Fredoka", data: fredoka, style: "normal" as const, weight: 600 as const }
      : null,
    outfit
      ? { name: "Outfit", data: outfit, style: "normal" as const, weight: 400 as const }
      : null,
  ].filter((font) => font !== null);

  const heading = fredoka ? "Fredoka" : "sans-serif";
  const body = outfit ? "Outfit" : "sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          padding: 56,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: PANE,
            borderRadius: 32,
            boxShadow: SHADOW,
            padding: 80,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: heading,
              fontSize: 40,
              letterSpacing: "-0.03em",
              marginBottom: 44,
            }}
          >
            <span style={{ color: INK }}>rota</span>
            <span style={{ color: GRAPE }}>.monster</span>
          </div>

          <div
            style={{
              display: "flex",
              fontFamily: heading,
              fontSize: 88,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: INK,
            }}
          >
            {SITE_TAGLINE}
          </div>

          <div
            style={{
              display: "flex",
              fontFamily: body,
              fontSize: 36,
              lineHeight: 1.3,
              color: MUTED,
              marginTop: 28,
            }}
          >
            {SITE_TITLE}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
