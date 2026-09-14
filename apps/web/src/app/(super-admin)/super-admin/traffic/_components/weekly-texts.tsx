import { BAR_TONE_FILL } from "@/components/charts/bars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TrafficWeek } from "@/lib/api/super-admin-traffic";
import { formatCount, stackShares } from "@/lib/charts";
import { formatRate } from "@/lib/hq-overview";
import { TEXT_KIND_SERIES, weekOfLabel } from "@/lib/hq-traffic";
import { cn } from "@/lib/utils";

/**
 * What the product actually sent, week by week, split by the three kinds of
 * text.
 *
 * HORIZONTAL rows rather than vertical columns, which is the phone deciding:
 * thirteen 90-day buckets as vertical bars at 390px is a 25px column with a
 * rotated label under it, and thirteen rows is thirteen rows. It also matches
 * the funnel above, so the page has one chart grammar rather than two.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. The legend names each kind with its total
 * beside it, every row prints its own total, and the table underneath holds
 * every number in the chart. That matters because these three hues are a pastel
 * family: run through the dataviz palette validator, reminder-lilac against
 * cover-notice-sky scores ΔE 14.8 for normal vision, just under the floor of
 * 15, which is why the peach segment is stacked BETWEEN them so the two never
 * share an edge — and why the numbers are always within reach of the colours.
 *
 * The 2px gap between segments is a border in the card's own colour rather than
 * a flex gap: a gap would push the row past 100% and the overflow would quietly
 * eat the last segment, which is usually the smallest one.
 */
export function WeeklyTexts({ weeks }: { weeks: readonly TrafficWeek[] }) {
  const totals = TEXT_KIND_SERIES.map((series) =>
    weeks.reduce((sum, week) => sum + week.texts_by_kind[series.kind], 0),
  );
  const sent = weeks.reduce((sum, week) => sum + week.texts_sent, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Texts each week</CardTitle>
        <CardDescription>
          Every text the product created that week, whatever became of it — including the ones that
          never left, so these bars and the failures below count the same rows.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="space-y-3.5">
          {weeks.map((week) => {
            const shares = stackShares(
              TEXT_KIND_SERIES.map((series) => week.texts_by_kind[series.kind]),
            );

            return (
              <li key={week.week_starting} className="grid gap-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium">
                    {weekOfLabel(week.week_starting)}
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    <span
                      className="font-heading text-foreground text-lg leading-none font-semibold"
                      data-numeric
                    >
                      {formatCount(week.texts_sent)}
                    </span>
                    <span className="text-muted-foreground ml-1 text-xs">sent</span>
                  </span>
                </span>

                <span className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full" aria-hidden>
                  {TEXT_KIND_SERIES.map((series, index) => {
                    // Branch on the COUNT, not the share. A kind that sent one
                    // text in a week of four thousand is a fact about that week,
                    // and a row that drops it draws the same picture as a week
                    // the kind never happened in. `stackShares` floors it at a
                    // tenth of a percent for the same reason, and the CSS floor
                    // below finishes the job at 4px — which is what `Bars` gives
                    // a small bar, so the page's two charts agree about when a
                    // small number is visible.
                    if (week.texts_by_kind[series.kind] <= 0) return null;

                    return (
                      <span
                        key={series.kind}
                        className={cn(
                          "border-card block h-full border-r-2 last:border-r-0",
                          BAR_TONE_FILL[series.tone],
                        )}
                        style={{ width: `${shares[index]}%`, minWidth: "0.25rem" }}
                      />
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ol>

        {/* The legend, with each kind's total over the range beside it. Present
            for every multi-series chart, and doing double duty as the direct
            labels that keep identity off colour alone. */}
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
          {TEXT_KIND_SERIES.map((series, index) => (
            <li key={series.kind} className="flex items-center gap-2 text-xs">
              <span
                className={cn("size-2.5 shrink-0 rounded-full", BAR_TONE_FILL[series.tone])}
                aria-hidden
              />
              <span className="text-muted-foreground">{series.label}</span>
              <span className="font-heading text-foreground font-semibold" data-numeric>
                {formatCount(totals[index])}
              </span>
            </li>
          ))}
        </ul>

        {/* The table view. Every figure the charts on this half draw, as numbers,
            for the reader who cannot tell two pastels apart, the one on a phone
            with no hover, and the one who wants to copy a row into a message.
            A <details> rather than a tab, so it costs no JavaScript. */}
        <details className="mt-6">
          <summary className="text-link marker:text-muted-foreground focus-visible:outline-ring inline-flex cursor-pointer items-center py-1 text-xs font-medium focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2">
            Show every week as numbers
          </summary>

          <div className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  {TEXT_KIND_SERIES.map((series) => (
                    <TableHead key={series.kind} className="text-right">
                      {series.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Delivery rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((week) => (
                  <TableRow key={week.week_starting}>
                    <TableCell className="whitespace-nowrap">
                      {weekOfLabel(week.week_starting)}
                    </TableCell>
                    {TEXT_KIND_SERIES.map((series) => (
                      <TableCell key={series.kind} className="text-right" data-numeric>
                        {formatCount(week.texts_by_kind[series.kind])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right" data-numeric>
                      {formatCount(week.texts_sent)}
                    </TableCell>
                    <TableCell className="text-right" data-numeric>
                      {formatCount(week.texts_delivered)}
                    </TableCell>
                    <TableCell className="text-right" data-numeric>
                      {formatCount(week.texts_failed)}
                    </TableCell>
                    {/* Null is "nothing settled that week", which is not 0%. */}
                    <TableCell className="text-muted-foreground text-right" data-numeric>
                      {week.delivery_rate === null ? "—" : formatRate(week.delivery_rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>

        <p className="text-muted-foreground mt-4 text-xs">
          {formatCount(sent)} texts across this window.
        </p>
      </CardContent>
    </Card>
  );
}
