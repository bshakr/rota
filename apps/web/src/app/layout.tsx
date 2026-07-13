import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";

import { ThemeColorMeta } from "@/components/theme-color-meta";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

// Figtree carries the whole product. It is a geometric humanist — open
// apertures, tall x-height, round terminals — which reads as friendly rather
// than corporate, and stays legible on a phone held at arm's length. That is
// the only place the member page is ever seen. globals.css records why Geist
// was rejected.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

// Machine strings only: magic-link tokens, Twilio SIDs. Never body copy.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
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
  // track --background (bone-100), and the lint rule is disabled for it.
  // eslint-disable-next-line no-restricted-syntax
  themeColor: "#f9f6ef",
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
      className={`${figtree.variable} ${jetbrainsMono.variable} h-full`}
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
