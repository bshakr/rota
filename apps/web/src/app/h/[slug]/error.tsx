"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";
import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Wordmark } from "@/components/wordmark";

// Household entry is public and unauthenticated, so a failure here is invisible
// to us unless it is reported: nobody signs in to complain. The visitor has no
// identity we want recorded, and the scrubber keeps their phone number out of the
// event, so all that reaches Sentry is that entry broke and how.
export default function EntryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/" prefetch={false}><Wordmark muted /></Link>
      </header>
      <Container asChild width="prose">
        <main className="flex flex-1 items-center py-16">
          <EmptyState
            icon={TriangleAlert}
            title="That one is on us."
            description="We couldn’t load your household. Try again in a moment. Links in your earlier reminder texts may still work."
            action={<Button onClick={reset}>Try again</Button>}
            className="w-full"
          />
        </main>
      </Container>
    </div>
  );
}
