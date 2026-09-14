import { StackLegend, StackedBars } from "@/components/charts/stacked-bars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuperAdminSpend } from "@/lib/api/super-admin-spend";
import { formatCount } from "@/lib/charts";
import {
  SPEND_SERIES,
  claudeShortfallNote,
  fixedCostPerHousePerMonth,
  formatMoney,
  monthLabel,
  pricingNote,
  seriesSplitNote,
} from "@/lib/hq-spend";

/**
 * What the product spent, month by month, split settled texts / estimated texts
 * / Claude.
 *
 * The split IS the argument. Twilio settles a price minutes after delivery, so
 * the newest month is always part invoice and part list-rate guess, and a single
 * "texts" bar would blend the two into one confident figure. Settled and
 * estimated therefore get their own segments, their own totals in the legend and
 * their own sentence underneath — the plan's "what the SMS figure can and cannot
 * say", drawn.
 *
 * THE FIXED COST IS NOT IN THE BARS. It is drawn as its own row below them,
 * because it is not a charge any house incurred: it is what the product pays
 * whether or not anybody sends a text. Stacking it into a month would make the
 * variable spend look like a rounding error on a chart about variable spend, and
 * would invite the operator to read a hosting bill as a per-house cost.
 *
 * The counts sit under the chart rather than inside it: segments and titles are
 * what the money bought, and a reader checking "why was August dear" wants them
 * next to the bars, not in a separate card three scrolls down.
 */
export function MonthlyTotals({ spend }: { spend: SuperAdminSpend }) {
  const fixedPerHouse = fixedCostPerHousePerMonth(spend);
  const claudeShortfall = claudeShortfallNote(spend.totals);

  const items = spend.months.map((month) => ({
    label: monthLabel(month.month),
    value: month.total,
    // Every number in the bar, in text, under the bar. The three segments are
    // the only place the split exists otherwise, and two of these chart cuts are
    // hard to tell apart for a protanopic reader (see SPEND_SERIES); printed,
    // the row is complete without them. The counts say what the money bought.
    note: `${seriesSplitNote(month, spend.currency)} · ${formatCount(month.segments)} ${month.segments === 1 ? "segment" : "segments"}, ${formatCount(month.titles_classified)} ${month.titles_classified === 1 ? "title" : "titles"} classified`,
    segments: SPEND_SERIES.map((series) => ({
      key: series.key,
      label: series.label,
      value: month[series.key] ?? 0,
      tone: series.tone,
    })),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Every month</CardTitle>
        <CardDescription>
          Texts and Claude, by UTC calendar month. The oldest bar is a part month — the window is an
          exact number of days ending now, not a run of whole months.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <StackedBars items={items} formatValue={(value) => formatMoney(value, spend.currency)} />

        <StackLegend
          className="mt-6"
          series={SPEND_SERIES.map((series) => ({
            key: series.key,
            label: series.label,
            tone: series.tone,
            // An unconverted Claude cost has no total to show in this
            // currency. The words say so; a zero would not.
            total:
              spend.totals[series.key] === null
                ? "not converted"
                : formatMoney(spend.totals[series.key] as number, spend.currency),
          }))}
        />

        {spend.fixed_monthly_cost_gbp === null ? null : (
          <div className="border-border mt-6 border-t pt-4">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">Fixed cost, every month</span>
              <span
                className="font-heading text-foreground shrink-0 text-lg leading-none font-semibold"
                data-numeric
              >
                {formatMoney(spend.fixed_monthly_cost_gbp, spend.currency)}
              </span>
            </span>
            {/* NO BAR HERE, deliberately. This figure cannot share the scale
                above it — hosting can dwarf a month of texts, and a shared axis
                would flatten every bar in the chart to nothing — and a
                full-width mark on its own scale is worse than none: sitting
                directly under four bars whose LENGTH is their value, it reads as
                the longest bar on the chart while meaning nothing at all. The
                numeral is the datum; the rule above and the caption below are
                what say "separate line". */}
            <p className="text-muted-foreground mt-2 text-xs text-pretty">
              Hosting, WorkOS and the Twilio number: paid whether or not anybody texts, so it is
              never stacked into a month above.{" "}
              {fixedPerHouse === null
                ? "No house spent anything in this window, so there is nobody to divide it among."
                : `Across the ${formatCount(spend.houses_with_spend)} ${spend.houses_with_spend === 1 ? "house" : "houses"} that spent anything, that is ${formatMoney(fixedPerHouse, spend.currency)} each per month.`}
            </p>
          </div>
        )}

        <p className="text-muted-foreground mt-6 text-xs text-pretty">
          {pricingNote(
            spend.totals,
            spend.sms_estimated_segment_cost_gbp,
            spend.currency,
            spend.sms_estimated_segment_cost_from_settled,
          )}
        </p>
        {claudeShortfall === null ? null : (
          <p className="text-muted-foreground mt-2 text-xs text-pretty">{claudeShortfall}</p>
        )}
      </CardContent>
    </Card>
  );
}
