"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";

import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

import "./globals.css";

// The boundary of last resort: it replaces the ROOT LAYOUT, which is why it has
// to render its own <html> and <body> and import globals.css itself. Without it a
// root-layout failure is a white page with nothing written down anywhere.
//
// Two things the root layout normally provides are absent here on purpose rather
// than by omission, because reaching for them is what would make this boundary
// fail too:
//
//   - The next/font variables are set on <html> by the root layout, so display
//     type falls back to the system rounded stack. A fallback face on the one
//     screen nobody should ever see is the right trade.
//   - next-themes is not mounted, so there is no `.dark` class and the page
//     renders in the light palette. Every colour below is still a semantic token:
//     the lint rule applies here exactly as it does everywhere else.
//
// Metadata exports are not supported in a Client Component, so the tab title is
// React's own <title> element.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // If the root layout threw on the server, onRequestError has already reported
    // it; this is the browser's copy, and the shared digest joins the two.
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-background text-foreground antialiased">
        <title>Something went wrong · Rota Monster</title>
        <header className="px-5 pt-7 md:px-8">
          <Wordmark muted />
        </header>
        <Container asChild width="prose">
          <main className="flex flex-1 items-center py-16">
            <EmptyState
              icon={TriangleAlert}
              title="That one is on us."
              description="The page could not load at all. Try again in a moment, and if it keeps happening we are already looking at it."
              action={<Button onClick={reset}>Try again</Button>}
              className="w-full"
            />
          </main>
        </Container>
      </body>
    </html>
  );
}
