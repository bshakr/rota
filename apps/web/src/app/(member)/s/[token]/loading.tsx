import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Shown while the rota streams in. It holds the page's real shape — a greeting,
// the next-shift card, the people strip, the filter chips and two day cards — so
// the layout doesn't jump when the feed arrives. It renders inside the member
// layout's own container, so no gutter of its own.
//
// Everything is a PILL except the date coins, which keep the coin's 18px
// radius: the placeholder should look like the clay it is about to become, not
// like a wireframe of it.
export default function Loading() {
  return (
    <div aria-busy aria-label="Loading your rota">
      <div className="mb-6">
        <Skeleton className="mb-3 h-10 w-44 rounded-full" />
        <Skeleton className="h-4 w-64 rounded-full" />
      </div>

      <Card className="mb-6">
        <div className="flex items-start gap-4 px-(--card-spacing)">
          <Skeleton className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2.5 pt-1">
            <Skeleton className="h-5 w-2/3 rounded-full" />
            <Skeleton className="h-4 w-1/2 rounded-full" />
          </div>
        </div>
      </Card>

      <div className="mb-6 flex gap-3">
        {[0, 1, 2, 3].map((person) => (
          <div key={person} className="flex w-16 flex-col items-center gap-1.5">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-3 w-10 rounded-full" />
          </div>
        ))}
      </div>

      {/* The filter chips: three 44px pills, the height they actually land at.
          Written out rather than mapped so Tailwind can see each width class. */}
      <div className="mb-6 flex gap-2">
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-20 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>

      <div className="space-y-6">
        {[0, 1].map((day) => (
          <div key={day}>
            <div className="mb-2 flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-xl" />
              <Skeleton className="h-4 w-32 rounded-full" />
            </div>
            <Card className="gap-0 py-0">
              <div className="space-y-3 px-4 py-3.5">
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-4 w-1/2 rounded-full" />
              </div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
