import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Shown while the shifts stream in. It holds the page's real shape, a greeting
// and a stack of shift cards, so the layout doesn't jump when the list arrives.
// It renders inside the member layout's own container, so no gutter of its own.
//
// Everything is a PILL except the date coin, which keeps the coin's 18px
// radius: the placeholder should look like the clay it is about to become, not
// like a wireframe of it.
export default function Loading() {
  return (
    <div aria-busy aria-label="Loading your shifts">
      <div className="mb-8">
        <Skeleton className="mb-3 h-10 w-44 rounded-full" />
        <Skeleton className="h-4 w-64 rounded-full" />
      </div>

      <div className="flex flex-col gap-4">
        {[0, 1].map((row) => (
          <Card key={row}>
            <div className="flex items-start gap-4 px-(--card-spacing)">
              <Skeleton className="size-14 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-5 w-2/3 rounded-full" />
                <Skeleton className="h-4 w-1/2 rounded-full" />
              </div>
            </div>
            <CardContent>
              {/* The cover CTA: a 44px pill, the same height it lands at. */}
              <Skeleton className="h-11 w-full rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
