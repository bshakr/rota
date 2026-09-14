import { Skeleton } from "@/components/ui/skeleton";

// Three bars, four tiles: the hero's words on the left and its 2x2 ledger on the right.
const HERO_LINES = ["h-3 w-24", "h-9 w-64 max-w-full", "h-4 w-80 max-w-full"] as const;

// The glance holds three days by default. Each is a date coin, a two-line heading, and a card of
// turns; the middle day carries two so the column does not read as a perfectly regular grid.
const GLANCE_DAYS = [1, 2, 1] as const;

/**
 * The dashboard's own skeleton, so the shell can paint before Rails has answered anything.
 *
 * The route streams now (BLO-1697): the (admin) layout flushes the nav, the wordmark and the
 * theme toggle immediately, holds the main column with a neutral placeholder while it finds out
 * whether the house is paused, and hands over to THIS the moment the answer is "no" and the page
 * starts fetching. It is the dashboard's shape and not a generic one, because the whole point of a
 * skeleton is that nothing jumps when the content arrives: the hero band at 32px, the household
 * card and the glance at 24px, the date coins at 12px, all on the same two-column grid the page
 * uses, down to the `space-y-8` between the days.
 *
 * Every bar is a pill in the quiet lavender fill, the Soft Clay idiom the members screen and the
 * app root already use.
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-busy aria-label="Loading dashboard">
      {/* The hero band. The real one carries drifting blobs; a skeleton does not, because a
          placeholder that animates in two directions reads as a thing rather than as a wait. */}
      <section className="bg-lavender-pane dark:bg-card mb-8 rounded-4xl p-6 shadow-sm md:p-9">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
          <div className="space-y-3">
            {HERO_LINES.map((size) => (
              <Skeleton key={size} className={`${size} rounded-full`} />
            ))}
          </div>
          <ul className="grid shrink-0 grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={`tile-${index}`}>
                <Skeleton className="h-24 w-32 rounded-2xl" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Your household page: text on the left, two pill buttons on the right. */}
      <div className="border-border bg-card mb-8 flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-5 w-44 rounded-full" />
          <Skeleton className="h-4 w-72 max-w-full rounded-full" />
          <Skeleton className="h-4 w-40 rounded-full" />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Skeleton className="h-9 w-48 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>

      {/* The week is the main column; group settings sit in the right rail, the same grid the
          page itself lays out, so the columns do not shift when the real thing arrives. */}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:gap-8">
        <div className="space-y-8">
          {GLANCE_DAYS.map((rows, day) => (
            <section key={`day-${day}`}>
              <div className="mb-3 flex items-center gap-3">
                {/* The date coin: 48px, 12px corners, exactly where the day's leaf lands. */}
                <Skeleton className="size-12 shrink-0 rounded-xl" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-20 rounded-full" />
                  <Skeleton className="h-3 w-28 rounded-full" />
                </div>
              </div>

              <div className="border-border bg-card divide-border divide-y overflow-hidden rounded-2xl border shadow-sm">
                {Array.from({ length: rows }).map((_, row) => (
                  <div
                    key={`row-${day}-${row}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <Skeleton className="h-4 w-32 rounded-full" />
                    <div className="flex shrink-0 items-center gap-2.5">
                      <Skeleton className="size-8 rounded-full" />
                      <Skeleton className="h-4 w-20 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* Next week, folded away behind its own hairline. */}
          <div className="border-border border-t pt-6">
            <Skeleton className="h-5 w-56 max-w-full rounded-full" />
          </div>
        </div>

        {/* Group settings: a card of a title, a paragraph and two fields. */}
        <div className="border-border bg-card space-y-5 rounded-2xl border p-5 shadow-sm">
          <div className="space-y-2.5">
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-4 w-full rounded-full" />
            <Skeleton className="h-4 w-3/4 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-16 rounded-full" />
            <Skeleton className="h-9 w-full max-w-sm rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24 rounded-full" />
            <Skeleton className="h-9 w-full max-w-sm rounded-full" />
          </div>
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}
