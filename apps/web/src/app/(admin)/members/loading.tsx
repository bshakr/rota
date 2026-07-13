import { Skeleton } from "@/components/ui/skeleton";

// A members-shaped skeleton — header, then table rows — so the layout holds its
// shape while the list streams in, rather than jumping. It renders inside the
// admin shell's Container, so no gutter of its own. The app-root loading.tsx is
// the generic fallback; this is the specific one this screen's shape earns.
export default function MembersLoading() {
  return (
    <div aria-busy aria-label="Loading members">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32 shrink-0" />
      </div>

      <div className="border-border bg-card overflow-hidden rounded-xl border">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`row-${index}`}
            className="border-border flex items-center gap-4 border-b p-4 last:border-b-0"
          >
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
