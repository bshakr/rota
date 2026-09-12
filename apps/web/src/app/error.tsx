"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

// The app-wide error boundary. A route that throws lands here instead of a
// white screen. `reset()` re-renders the failed segment, which recovers from a
// transient fetch failure without a full reload. Must be a Client Component,
// because error boundaries always are.
//
// It renders inside the bare root layout, so the muted wordmark is the only
// chrome: enough to say which product just fell over, without pretending the
// admin shell is still around it.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Once observability lands this is where it reports. For now the digest is
    // enough to correlate a user report with a server log line.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/">
          <Wordmark muted />
        </Link>
      </header>
      <Container width="prose" className="flex flex-1 items-center py-16">
        <EmptyState
          icon={TriangleAlert}
          title="That one is on us."
          description="Something went wrong on our side. Try again in a moment."
          action={<Button onClick={reset}>Try again</Button>}
          className="w-full"
        />
      </Container>
    </div>
  );
}
