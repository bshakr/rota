"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";

import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// The app-wide error boundary. A route that throws lands here instead of a white
// screen. `reset()` re-renders the failed segment, which recovers from a
// transient fetch failure without a full reload. Must be a Client Component —
// error boundaries always are.
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
    <Container width="prose" className="flex flex-1 items-center py-16">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="This one is on us, not you. Try again — and if it keeps happening, let whoever runs your rota know."
        action={<Button onClick={reset}>Try again</Button>}
        className="w-full"
      />
    </Container>
  );
}
