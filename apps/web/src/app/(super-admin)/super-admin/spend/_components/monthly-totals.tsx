import { StackLegend, StackedBars } from "@/components/charts/stacked-bars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuperAdminSpend } from "@/lib/api/super-admin-spend";
import { formatCount } from "@/lib/charts";
import {
  SPEND_SERIES,
  claudeShortfallNote,
  fixedCostPerHousePerMonth,
    formatUsd,
  monthLabel,
  pricingNote,
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
    note: `${formatCount(month.segments)} ${month.segments === 1 ? "segment" : "segments"}, ${formatCount(month.titles_classified)} ${month.titles_classified === 1 ? "title" : "titles"} classified`,
    segments: SPEND_SERIES.map((series) => ({
      key: series.key,
      label: series.label,
      value: month[series.key],
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
        <StackedBars items={items} formatValue={formatUsd} />

        <StackLegend
          className="mt-6"
          series={SPEND_SERIES.map((series) => ({
            key: series.key,
            label: series.label,
            tone: series.tone,
            total: formatUsd(spend.totals[series.key]),
          }))}
        />

        {spend.fixed_monthly_cost_usd === null ? null : (
          <div className="border-border mt-6 border-t pt-4">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">Fixed cost, every month</span>
              <span
                className="font-heading text-foreground shrink-0 text-lg leading-none font-semibold"
                data-numeric
              >
                {formatUsd(spend.fixed_monthly_cost_usd)}
              </span>
            </span>
            {/* Its own full-width track on its own scale, and deliberately not to
                the same scale as the months above: hosting can dwarf a month of
                texts, and a shared axis would flatten every bar in the chart to
                nothing. The number beside it is the datum; the mark only says
                "this is a separate line". */}
            <span
              className="bg-muted mt-1.5 block h-2.5 w-full overflow-hidden rounded-full"
              aria-hidden
            >
              <span className="bg-chart-4 block h-full w-full rounded-full" />
            </span>
            <p className="text-muted-foreground mt-2 text-xs text-pretty">
              Hosting, WorkOS and the Twilio number: paid whether or not anybody texts, so it is
              never stacked into a month above.{" "}
              {fixedPerHouse === null
                ? "No house spent anything in this window, so there is nobody to divide it among."
                : `Across the ${formatCount(spend.houses_with_spend)} ${spend.houses_with_spend === 1 ? "house" : "houses"} that spent anything, that is ${formatUsd(fixedPerHouse)} each per month.`}
            </p>
          </div>
        )}

        <p className="text-muted-foreground mt-6 text-xs text-pretty">
          {pricingNote(spend.totals, spend.sms_estimated_segment_cost_usd)}
        </p>
        {claudeShortfall === null ? null : (
          <p className="text-muted-foreground mt-2 text-xs text-pretty">{claudeShortfall}</p>
        )}
      </CardContent>
    </Card>
  );
}
