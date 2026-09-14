import { Sparkline } from "@/components/charts/sparkline";
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
import { formatCount } from "@/lib/charts";
import { plural } from "@/lib/hq-overview";
import { WEEKLY_SIGNALS, weekLabel, weekOfLabel } from "@/lib/hq-traffic";

/**
 * Five series, five small multiples: covers, active houses, active people,
 * members most recently seen, new houses.
 *
 * SMALL MULTIPLES rather than five lines on one chart, and that is the
 * one-axis rule doing its job. Covers run in the tens and active people in the
 * dozens; drawn together, one of them would need a second y-scale, which is the
 * single worst thing a chart can do. Five identical little panels compare
 * perfectly well by SHAPE, which is what a sparkline is for.
 *
 * Each panel leads with its MOST RECENT week, not a range total, because three
 * of these five are distinct counts that cannot be added up: the same house
 * active every week is one house, not thirteen. The two that are genuine event
 * counts — covers and new houses — do print a range total, and say so.
 *
 * That newest week is marked "so far" on every panel, and in the table. It runs
 * from its Monday to NOW rather than to Sunday, so it is a week in progress in
 * every range the picker offers, and a headline figure that did not say so would
 * read as a finished week that had collapsed.
 *
 * `members_last_seen` is the panel that needs its words most. It counts members
 * in the week they were LAST seen, one moving column with no history behind it,
 * so it rises towards today however the housemates behaved. The label says
 * "most recently seen" for that reason.
 */
export function WeeklySignals({ weeks }: { weeks: readonly TrafficWeek[] }) {
  const latestWeek = weeks.at(-1);
  const firstWeek = weeks.at(0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>The weekly signals</CardTitle>
        <CardDescription>
          Five series across the same weeks, each drawn on its own scale — they measure different
          things and a shared axis would flatten four of them.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {WEEKLY_SIGNALS.map((signal) => {
            const values = weeks.map((week) => week[signal.key]);
            const points = weeks.map((week, index) => ({
              label: weekOfLabel(week.week_starting),
              value: values[index],
            }));
            const latest = latestWeek ? latestWeek[signal.key] : 0;
            const total = values.reduce((sum, value) => sum + value, 0);

            return (
              <li key={signal.key} className="bg-muted rounded-2xl p-4">
                <p className="text-sm font-medium text-pretty">{signal.label}</p>

                <p className="mt-1.5 flex items-baseline gap-2">
                  <span
                    className="font-heading text-foreground text-2xl leading-none font-semibold"
                    data-numeric
                  >
                    {formatCount(latest)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {latestWeek
                      ? `week of ${weekLabel(latestWeek.week_starting)} so far`
                      : "no weeks"}
                  </span>
                </p>

                <div className="mt-3">
                  <Sparkline
                    points={points}
                    label={`${signal.label} by week, ${points.length} ${plural(points.length, "week", "weeks")}, oldest first`}
                  />
                  <p className="text-muted-foreground mt-1 flex justify-between text-[11px]">
                    <span>{firstWeek ? weekLabel(firstWeek.week_starting) : null}</span>
                    <span>{latestWeek ? weekLabel(latestWeek.week_starting) : null}</span>
                  </p>
                </div>

                <p className="text-muted-foreground mt-2 text-xs text-pretty">
                  {signal.summable ? `${formatCount(total)} across the window. ` : null}
                  {signal.note}
                </p>
              </li>
            );
          })}
        </ul>

        {/* The table view for these five lines, and the reason it is here rather
            than folded into the texts table one card up: that one covers the
            kinds, the delivery and the rate, and NONE of these. Four of these
            five series appear nowhere else on the page as numbers, so without
            this the only way to read one would be to see its shape — no use to
            a reader who cannot separate two line shapes, or who is on a phone
            with no hover. A <details> rather than a tab, so it costs no
            JavaScript. */}
        <details className="mt-6">
          <summary className="text-link marker:text-muted-foreground focus-visible:outline-ring inline-flex cursor-pointer items-center py-1 text-xs font-medium focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2">
            Show every signal as numbers
          </summary>

          <div className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  {WEEKLY_SIGNALS.map((signal) => (
                    <TableHead key={signal.key} className="text-right">
                      {signal.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((week) => (
                  <TableRow key={week.week_starting}>
                    <TableCell className="whitespace-nowrap">
                      {weekOfLabel(week.week_starting)}
                      {week.week_starting === latestWeek?.week_starting ? (
                        <span className="text-muted-foreground"> so far</span>
                      ) : null}
                    </TableCell>
                    {WEEKLY_SIGNALS.map((signal) => (
                      <TableCell key={signal.key} className="text-right" data-numeric>
                        {formatCount(week[signal.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
