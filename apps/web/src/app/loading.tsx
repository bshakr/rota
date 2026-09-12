import { Container } from "@/components/container";
import { Skeleton } from "@/components/ui/skeleton";

// The default route-level loading state, shown while a Server Component
// streams. Skeletons rather than a spinner: they hold the shape of a page so
// the layout does not jump when content arrives. In Soft Clay they are quiet
// lavender fills at the same radii as the things they stand in for, a pill for
// the title and 24px cards for the rows, so the wait looks like the page rather
// than like scaffolding. A screen with a more specific shape (a table, the
// member shift list) ships its own loading.tsx next to it.
export default function Loading() {
  return (
    <Container className="py-10" aria-busy aria-label="Loading">
      <Skeleton className="mb-8 h-8 w-48 rounded-full" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </Container>
  );
}
