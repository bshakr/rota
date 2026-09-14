import { barPercents, formatCount } from "@/lib/charts";
import { cn } from "@/lib/utils";

/**
 * A FLAT BAR CHART: one horizontal bar per row, laid on the quiet fill, with
 * the value beside it as a Fredoka numeral.
 *
 * Horizontal rather than vertical, and that is the phone deciding. Thirteen
 * weeks of vertical bars at 390px is a 25px column with a rotated label under
 * it; thirteen rows is thirteen rows, and every label stays horizontal, full
 * length and legible. It also means one grammar for both charts on the traffic
 * page — the funnel and the weekly texts read the same way.
 *
 * **The bar is decoration; the number is the datum.** Every row prints its own
 * value, so the track is `aria-hidden` and there is no tooltip to hunt for: the
 * chart is fully readable as text, on a phone, with a screen reader, and in
 * forced-colours mode where the fill may not render at all. That is also what
 * pays for the fill colour sitting below 3:1 against the card — a pastel-family
 * chart cut is an identity marker, never the only carrier of a value.
 *
 * Fills come from the design system's `--chart-*` cuts rather than the sticker
 * pastels. A sticker is `bg-lilac` at L 0.90, and the quiet fill it would sit
 * on is L 0.94: a 1.09:1 bar, which is a bar you cannot see. The deeper cuts are
 * what globals.css already calls "the deeper cuts for coins and chart series".
 *
 * Generic on purpose — the group dashboard
 * (https://linear.app/bloombase/issue/BLO-1680) draws its own bars from this.
 * It knows nothing about traffic, funnels or weeks: rows in, bars out.
 */

export type BarDatum = {
  label: string;
  /**
   * Null is NOT ZERO. It means the row is not measured, and the bar is left
   * undrawn with `note` saying why. The traffic funnel's first step is exactly
   * this: landing views are not counted yet, and a zero-length bar would say
   * nobody visited.
   */
  value: number | null;
  /** What the value counts — "houses", "users". Rendered small, beside the numeral. */
  unit?: string;
  /** One quiet line under the bar: a rate, a caveat, why there is no bar. */
  note?: string;
};

/**
 * Which of the five chart cuts the bars wear. Named for the pigment family so a
 * caller can honour a palette written in the product's own words ("reminder
 * lilac, cover notice sky") without reaching past the tokens.
 *
 * `grape` is lilac's loud cut — the same hue (290) the sticker sheet calls
 * lilac, at the lightness a chart mark needs.
 */
export type BarTone = "grape" | "mint" | "peach" | "sky" | "blush";

export const BAR_TONE_FILL: Record<BarTone, string> = {
  grape: "bg-chart-1",
  mint: "bg-chart-2",
  peach: "bg-chart-3",
  sky: "bg-chart-4",
  blush: "bg-chart-5",
};

export function Bars({
  items,
  tone = "grape",
  className,
}: {
  items: readonly BarDatum[];
  tone?: BarTone;
  className?: string;
}) {
  const widths = barPercents(items.map((item) => item.value));

  return (
    <ol className={cn("space-y-3.5", className)}>
      {items.map((item, index) => {
        const width = widths[index];

        return (
          <li key={item.label} className="grid gap-1.5">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm font-medium break-words">{item.label}</span>
              <span className="shrink-0 whitespace-nowrap">
                <span
                  className="font-heading text-foreground text-lg leading-none font-semibold"
                  data-numeric
                >
                  {item.value === null ? "—" : formatCount(item.value)}
                </span>
                {item.unit ? (
                  <span className="text-muted-foreground ml-1 text-xs">{item.unit}</span>
                ) : null}
              </span>
            </span>

            {/* The track is the quiet fill and the bar is the mark. Rounded at
                both ends and anchored to the left edge, so length is the only
                thing carrying magnitude. */}
            <span className="bg-muted block h-2.5 w-full overflow-hidden rounded-full" aria-hidden>
              {width === null ? null : (
                <span
                  className={cn("block h-full rounded-full", BAR_TONE_FILL[tone])}
                  // A real count should never render as nothing at all: a bar
                  // under a pixel or two disappears into the track and an
                  // operator reads "none" off a row that says 3. Four pixels is
                  // the smallest mark that still reads as a mark.
                  style={{ width: `${width}%`, minWidth: item.value ? "0.25rem" : undefined }}
                />
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
