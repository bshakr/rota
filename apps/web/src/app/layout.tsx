import type { Metadata, Viewport } from "next";
import { Fredoka, Outfit, Space_Mono } from "next/font/google";

import { ThemeColorMeta } from "@/components/theme-color-meta";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

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
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: { default: "Rota Monster", template: "%s · Rota Monster" },
  description: "Whose turn? Sorted.",
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
    <html
      lang="en"
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
