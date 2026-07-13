import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";

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
  // Tints the phone's browser chrome to match the page, so the member page fills
  // the screen instead of sitting inside someone else's white box.
  //
  // The only raw colours in the codebase, and the lint rule below is switched off
  // by hand to allow them: a <meta> tag is read by the browser before any CSS
  // exists, so it cannot reference a custom property. These two values MUST track
  // --background in globals.css (bone-100 in light, bone-950 in dark).
  /* eslint-disable no-restricted-syntax */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f6ef" },
    { media: "(prefers-color-scheme: dark)", color: "#18130f" },
  ],
  /* eslint-enable no-restricted-syntax */
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
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
