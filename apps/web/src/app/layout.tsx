import type { Metadata, Viewport } from "next";
import { Fredoka, Outfit, Space_Mono } from "next/font/google";

import { ThemeColorMeta } from "@/components/theme-color-meta";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SITE_DESCRIPTION, SITE_NAME, siteOrigin, TITLE_TEMPLATE } from "@/lib/site";

import "./globals.css";

// SOFT CLAY type pairing — two voices, one personality.
//
// Fredoka is the display voice: a soft, wide-shouldered rounded sans with a
// `wdth` axis. Loaded with that axis so globals.css can press it to 108 on
// `.font-heading`; at 600 the letterforms go pillowy, which is the whole point.
// The greeting on the member page should feel like a note on the fridge, not a
// heading in a dashboard.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
  fallback: ["ui-rounded", "Avenir Next", "Segoe UI", "system-ui", "sans-serif"],
});

// Outfit carries the body: a clean geometric sans whose round bowls sit under
// Fredoka without competing, and which stays legible on a phone held at arm's
// length — the only place the member page is ever seen.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

// Machine strings only: magic-link tokens, Twilio SIDs. Space Mono because
// even the machine strings get a little charm here.
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  // Not preloaded. It is declared in the ROOT layout so `--font-space-mono` exists
  // everywhere, but the only surfaces that set it are admin ones — the magic-link
  // token, Twilio SIDs. Preloading pushed two <link rel="preload"> tags onto the
  // landing page, which is the page that has to be fast and never renders a
  // machine string. `display: "swap"` means the admin pages that do use it paint
  // in the fallback and swap, costing nothing visible.
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  // Every relative URL in metadata — the canonical, og:url, the generated
  // og:image — is resolved against this into the absolute form crawlers and link
  // scrapers require. Next warns at build without it and emits relative og tags,
  // which Slack and Facebook simply drop. `siteOrigin()` reads APP_URL and falls
  // back to the production domain so a .env-less CI build still resolves.
  metadataBase: new URL(siteOrigin()),
  // The template covers every route BELOW this layout. It does NOT cover `/`,
  // which is this layout's own segment; page.tsx applies the same constant by
  // hand. See TITLE_TEMPLATE in lib/site.ts.
  title: { default: SITE_NAME, template: TITLE_TEMPLATE },
  // The default for every route. Only `/` is reachable without a session, so in
  // practice this is the homepage's description and is overridden nowhere; it
  // lives here rather than only in page.tsx so no future public route ships blank.
  description: SITE_DESCRIPTION,
};

export const viewport: Viewport = {
  // The SSR default for the browser-chrome tint (light --background, the
  // lavender page). It is a sensible first paint for no-JS and pre-hydration;
  // <ThemeColorMeta> then updates this same tag to the RESOLVED theme, which is
  // why there is one value here and not a pair of media-query tags — those
  // track the OS rather than the theme the user actually chose, and a second
  // tag would be left stale when ThemeColorMeta rewrites the first. A <meta> is
  // read before any CSS exists so it cannot reference a token: this raw hex
  // must track --background (lavender-100), and the lint rule is disabled for
  // it. The dark counterpart lives in theme-color-meta.tsx.
  // eslint-disable-next-line no-restricted-syntax
  themeColor: "#f5f1ff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required by next-themes: it stamps the theme
    // class onto <html> before React hydrates, so server and client markup
    // legitimately differ on this one element.
    //
    // en-GB, not en: the copy is British throughout and the JSON-LD graph claims
    // `inLanguage: "en-GB"`, so the document element has to agree with it.
    <html
      lang="en-GB"
      className={`${fredoka.variable} ${outfit.variable} ${spaceMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeColorMeta />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
