import Link from "next/link";

import { SPEND_RANGES, type SpendRange } from "@/lib/spend-constants";
import { SPEND_RANGE_LABELS, spendRangeHref } from "@/lib/hq-spend";
import { cn } from "@/lib/utils";

/**
 * The window this page is about: 30 days, 90 days or 12 months.
 *
 * THREE LINKS, not a select and not a client component. The range is in the URL
 * (`?range=90d`), so the picker is navigation: it is bookmarkable, shareable,
 * survives a refresh, works with the back button and needs no JavaScript at all.
 * A `<select>` with an onChange would need a Client Component, a router push and
 * a pending state, to do something an anchor already does.
 *
 * `aria-current="page"` is what makes the pressed pill mean something to a
 * screen reader — the fill is the sighted half of the same statement.
 *
 * Deliberately the same control the traffic page ships, down to the class list:
 * two operator pages with two different range pickers is how an operator learns
 * to distrust one of them. The two differ only in which windows they offer and
 * where they link, so this is the second copy rather than the first — worth
 * folding into one `components/range-picker.tsx` taking `{ options, labels,
 * href }`, which is a tidy-up across a merged traffic page and deliberately not
 * done from a spend ticket.
 */
export function RangePicker({ range }: { range: SpendRange }) {
  return (
    <nav aria-label="Time range" className="bg-muted inline-flex rounded-full p-1">
      {SPEND_RANGES.map((option) => {
        const active = option === range;

        return (
          <Link
            key={option}
            href={spendRangeHref(option)}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 44px tall, like the shell's nav rows: this is the one control on
              // the page that is not the calculator, and it is tapped on a phone.
              "flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors",
              "outline-hidden focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2",
              active
                ? "bg-card text-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {SPEND_RANGE_LABELS[option]}
          </Link>
        );
      })}
    </nav>
  );
}
