import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans, Space_Mono } from "next/font/google";

import { ThemeColorMeta } from "@/components/theme-color-meta";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

// SOLSTICE type pairing — two voices, one personality.
//
// Fraunces is the display voice: a warm, slightly wonky optical serif with a
// SOFT axis. Set soft (globals.css does this for .font-heading), it smiles —
// the greeting on the member page should feel like a friend's handwriting on
// a kitchen note, not a heading in a dashboard.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

// Plus Jakarta Sans carries the body: a warm geometric humanist with open
// counters that stays legible on a phone held at arm's length — the only place
// the member page is ever seen.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

// Machine strings only: magic-link tokens, Twilio SIDs. Space Mono because
// even the machine strings get a little charm here.
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "HouseRota", template: "%s · HouseRota" },
  description: "Whose turn is it?",
};

export const viewport: Viewport = {
  // The SSR default for the browser-chrome tint (light --background). It is a
  // sensible first paint for no-JS and pre-hydration; <ThemeColorMeta> then
  // updates this same tag to the RESOLVED theme, because a media-query tag would
  // track the OS rather than the theme the user actually chose. A <meta> is read
  // before any CSS exists so it cannot reference a token — this raw hex must
  // track --background (sunbeam-100), and the lint rule is disabled for it.
  // eslint-disable-next-line no-restricted-syntax
  themeColor: "#fbf7eb",
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
      className={`${fraunces.variable} ${jakarta.variable} ${spaceMono.variable} h-full`}
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
