import { Container } from "@/components/container";
import { Skeleton } from "@/components/ui/skeleton";

// The default route-level loading state, shown while a Server Component streams.
// A neutral skeleton rather than a spinner: it holds the shape of a page so the
// layout does not jump when content arrives. A screen with a more specific shape
// (a table, the member shift list) ships its own loading.tsx next to it.
export default function Loading() {
  return (
    <Container className="py-10" aria-busy aria-label="Loading">
      <Skeleton className="mb-8 h-8 w-48" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </Container>
  );
}
