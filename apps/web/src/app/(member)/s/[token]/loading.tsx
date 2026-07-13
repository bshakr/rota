import { Skeleton } from "@/components/ui/skeleton";

// Shown while the shifts stream in. It holds the page's real shape — a greeting
// and a stack of shift cards — so the layout doesn't jump when the list arrives.
// It renders inside the member layout's own container, so no gutter of its own.
export default function Loading() {
  return (
    <div aria-busy aria-label="Loading your shifts">
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-8 h-4 w-64" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  );
}
