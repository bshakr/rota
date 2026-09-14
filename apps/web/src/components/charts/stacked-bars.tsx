import { BAR_TONE_FILL, type BarTone } from "@/components/charts/bars";
import { barPercents, stackShares } from "@/lib/charts";
import { cn } from "@/lib/utils";

/**
 * A STACKED FLAT BAR CHART: one horizontal bar per row, laid on the quiet fill,
 * split into segments, with the row's own total beside it as a Fredoka numeral.
 *
 * Horizontal rather than vertical, and that is the phone deciding. Thirteen
 * months of vertical bars at 390px is a 25px column with a rotated label under
 * it; thirteen rows is thirteen rows, and every label stays horizontal, full
 * length and legible.
 *
 * **The bar is decoration; the number is the datum.** Every row prints its own
 * value and the legend carries each series' total, so the track is `aria-hidden`
 * and there is no tooltip to hunt for: the chart is fully readable as text, on a
 * phone, with a screen reader, and in forced-colours mode where the fill may not
 * render at all. That is also what pays for the fill colours sitting below 3:1
 * against the card — a pastel-family chart cut is an identity marker, never the
 * only carrier of a value.
 *
 * The 2px gap between segments is a BORDER in the card's own colour rather than
 * a flex gap: a gap would push the row past 100% and the overflow would quietly
 * eat the last segment, which is usually the smallest one.
 *
 * ---
 *
 * ./bars.tsx is the single-series sibling, and this deliberately borrows
 * everything it can from it: the same `{ label, value, unit?, note? }` datum
 * (plus the segments a stack needs), the same `BarTone` cuts and their fills,
 * and the same geometry helpers from lib/charts.ts. Two chart components in one
 * folder with two ideas of what a bar looks like is how one page starts
 * disagreeing with another about the same number.
 *
 * The traffic page's weekly texts chart stacks inline
 * (https://linear.app/bloombase/issue/BLO-1682). Its markup and this are now the
 * same shape; folding that chart onto this component is a tidy-up worth doing,
 * and is deliberately not done here so a spend ticket does not rewrite a merged
 * traffic chart.
 */

export type StackSegment = {
  /** Stable across rows — it is the React key and the legend's identity. */
  key: string;
  label: string;
  value: number;
  tone: BarTone;
};

export type StackDatum = {
  label: string;
  /**
   * The row's own figure, printed as the numeral. Null is NOT ZERO: it means the
   * row is not measured, the bar is left undrawn and `note` says why.
   */
  value: number | null;
  /** What the value is in — "spent", "texts". Rendered small, beside the numeral. */
  unit?: string;
  /** One quiet line under the bar: a caveat, a count, why there is no bar. */
  note?: string;
  segments: readonly StackSegment[];
};

export function StackedBars({
  items,
  formatValue,
  className,
}: {
  items: readonly StackDatum[];
  /** How the numeral reads. Money on the spend page; a plain count elsewhere. */
  formatValue: (value: number) => string;
  className?: string;
}) {
  // TWO SCALES, and the chart needs both. The outer width is this row against
  // the largest row in the set, which is magnitude; the segments then divide
  // that width, which is composition. Share alone would draw a forty-cent month
  // and a six-dollar month as identical full-width bars.
  const widths = barPercents(items.map((item) => item.value));

  return (
    <ol className={cn("space-y-3.5", className)}>
      {items.map((item, index) => {
        const width = widths[index];
        const shares = stackShares(item.segments.map((segment) => segment.value));

        return (
          <li key={item.label} className="grid gap-1.5">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm font-medium break-words">{item.label}</span>
              <span className="shrink-0 whitespace-nowrap">
                <span
                  className="font-heading text-foreground text-lg leading-none font-semibold"
                  data-numeric
                >
                  {item.value === null ? "not measured" : formatValue(item.value)}
                </span>
                {item.unit ? (
                  <span className="text-muted-foreground ml-1 text-xs">{item.unit}</span>
                ) : null}
              </span>
            </span>

            {/* The track is the quiet fill and the segments are the marks. A row
                whose total is zero renders as an empty track rather than as no
                row at all: a hole in a monthly series reads as missing data,
                which is a different and worse statement than a quiet month. */}
            <span className="bg-muted block h-2.5 w-full overflow-hidden rounded-full" aria-hidden>
              {width === null ? null : (
                <span
                  className="flex h-full overflow-hidden rounded-full"
                  // A real figure should never render as nothing at all: a bar
                  // under a pixel or two disappears into the track and an
                  // operator reads "none" off a row that cost money. Four pixels
                  // is the smallest mark that still reads as a mark.
                  style={{ width: `${width}%`, minWidth: item.value ? "0.25rem" : undefined }}
                >
                  {item.segments.map((segment, position) => {
                    const share = shares[position];
                    if (share <= 0) return null;

                    return (
                      <span
                        key={segment.key}
                        className={cn(
                          "border-card block h-full border-r-2 last:border-r-0",
                          BAR_TONE_FILL[segment.tone],
                        )}
                        style={{ width: `${share}%` }}
                      />
                    );
                  })}
                </span>
              )}
            </span>

            {item.note ? (
              <span className="text-muted-foreground block text-xs text-pretty">{item.note}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The legend: every series named, with its own total beside it.
 *
 * Present for every multi-series chart, and doing double duty as the direct
 * labels that keep identity off colour alone.
 */
export function StackLegend({
  series,
  className,
}: {
  series: readonly { key: string; label: string; tone: BarTone; total: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-2", className)}>
      {series.map((entry) => (
        <li key={entry.key} className="flex items-center gap-2 text-xs">
          <span
            className={cn("size-2.5 shrink-0 rounded-full", BAR_TONE_FILL[entry.tone])}
            aria-hidden
          />
          <span className="text-muted-foreground">{entry.label}</span>
          <span className="font-heading text-foreground font-semibold" data-numeric>
            {entry.total}
          </span>
        </li>
      ))}
    </ul>
  );
}
