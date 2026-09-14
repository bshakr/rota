import Link from "next/link";

import { TRAFFIC_RANGES, type TrafficRange } from "@/lib/api/super-admin-traffic";
import { RANGE_LABELS, rangeHref } from "@/lib/hq-traffic";
import { cn } from "@/lib/utils";

/**
 * The window this page is about: 7, 30 or 90 days.
 *
 * THREE LINKS, not a select and not a client component. The range is in the URL
 * (`?range=90d`), so the picker is navigation: it is bookmarkable, shareable,
 * survives a refresh, works with the back button and needs no JavaScript at all.
 * A `<select>` with an onChange would need a Client Component, a router push and
 * a pending state, to do something an anchor already does.
 *
 * `aria-current="page"` is what makes the pressed pill mean something to a
 * screen reader — the lilac fill is the sighted half of the same statement.
 */
export function RangePicker({ range }: { range: TrafficRange }) {
  return (
    <nav aria-label="Time range" className="bg-muted inline-flex rounded-full p-1">
      {TRAFFIC_RANGES.map((option) => {
        const active = option === range;

        return (
          <Link
            key={option}
            href={rangeHref(option)}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 44px tall, like the shell's nav rows: this is the one control on
              // the page and it is tapped on a phone.
              "flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors",
              "outline-hidden focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2",
              active
                ? "bg-card text-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {RANGE_LABELS[option]}
          </Link>
        );
      })}
    </nav>
  );
}
