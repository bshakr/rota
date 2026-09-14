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
import type { WeeklyWeek } from "@/lib/api/super-admin-groups";
import { formatCount } from "@/lib/charts";
import {
  GROUP_SECTION,
  USAGE_LATEST_NOTE,
  USAGE_SERIES,
  usagePoints,
  usageTotal,
} from "@/lib/hq-group-report";
import { plural } from "@/lib/hq-overview";
import { weekLabel, weekOfLabel } from "@/lib/hq-traffic";

import { Empty } from "./group-admins";

/**
 * Is this house still being used? Twelve weeks of texts and twelve weeks of
 * covers.
 *
 * TWO PANELS, NOT ONE CHART, and that is the one-axis rule rather than taste. A
 * busy house sends dozens of texts a week and records perhaps one cover a month;
 * drawn on a shared scale the covers line lies flat on the floor, and giving it a
 * second y-axis is the single worst thing a chart can do. Two small multiples
 * compare perfectly well by SHAPE, which is what a sparkline is for.
 *
 * The headline is the MOST RECENT week and the range total beside it. Both series
 * are genuine event counts — a text is a text, a cover is a cover — so adding
 * twelve weeks up is a true statement, unlike the distinct counts on the traffic
 * page which say "cannot be summed" for exactly this reason.
 *
 * The newest bucket is the week we are inside: it runs from its Monday to NOW
 * rather than to Sunday, so it is marked "so far" both here and in the table. A
 * week in progress that did not say so reads as a finished week that collapsed.
 *
 * THE NUMBERS ARE ALWAYS AVAILABLE AS NUMBERS. A sparkline with no axis is a
 * shape, and a reader who cannot separate two line shapes — or who is on a phone
 * with no hover — has nothing else to go on. The `<details>` table is the same
 * twelve rows as text, costs no JavaScript, and is the accessibility answer as
 * well as the "what exactly was week six" one.
 *
 * These weeks are MONDAY UTC — the operator's week, shared with the overview and
 * the traffic page — and deliberately not this house's own. Three screens each
 * drawing their own week boundary would put the same text in a different column
 * on each.
 */
export function GroupUsage({ weeks }: { weeks: WeeklyWeek[] }) {
  const first = weeks.at(0);
  const latest = weeks.at(-1);

  return (
    <Card id={GROUP_SECTION.usage} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Twelve weeks of use</CardTitle>
        <CardDescription>
          Weeks start on Monday UTC, the same boundary the overview and the traffic page use, so
          one text lands in the same column on all three.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {weeks.length === 0 ? (
          <Empty>No weekly figures came back for this house.</Empty>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {USAGE_SERIES.map((series) => {
                const points = usagePoints(weeks, series.key);
                const total = usageTotal(weeks, series.key);

                return (
                  <li key={series.key} className="bg-muted rounded-2xl p-4">
                    <p className="text-sm font-medium text-pretty">{series.label}</p>

                    <p className="mt-1.5 flex items-baseline gap-2">
                      <span
                        className="font-heading text-foreground text-2xl leading-none font-semibold"
                        data-numeric
                      >
                        {formatCount(latest ? latest[series.key] : 0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {latest
                          ? `week of ${weekLabel(latest.week_start)} ${USAGE_LATEST_NOTE}`
                          : "no weeks"}
                      </span>
                    </p>

                    <div className="mt-3">
                      <Sparkline
                        points={points}
                        label={`${series.label} by week, ${points.length} ${plural(points.length, "week", "weeks")}, oldest first`}
                      />
                      {/* Two labels, not twelve: the ends are what a sparkline's
                          axis needs, and a label under every point at 390px is a
                          smudge. The table below carries the rest. */}
                      <p className="text-muted-foreground mt-1 flex justify-between text-[11px]">
                        <span>{first ? weekLabel(first.week_start) : null}</span>
                        <span>{latest ? weekLabel(latest.week_start) : null}</span>
                      </p>
                    </div>

                    <p className="text-muted-foreground mt-2 text-xs text-pretty">
                      {formatCount(total)} across these {weeks.length} weeks. {series.note}
                    </p>
                  </li>
                );
              })}
            </ul>

            <details className="mt-5">
              <summary className="text-link marker:text-muted-foreground focus-visible:outline-ring inline-flex cursor-pointer items-center py-1 text-xs font-medium focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2">
                Show every week as numbers
              </summary>

              {/* Three columns and a phone: the table is made to FIT at 390px
                  rather than given the log's sideways scroller, because a
                  clipped "Covers" header on a card whose whole point is the
                  numbers reads as a bug. Two things buy the room — tighter
                  gutters below sm, and a week cell allowed to wrap there, so
                  only the one row carrying "so far" takes a second line. Both
                  are undone from sm up, where the full padding fits easily. The
                  scroll box stays as the floor for a narrower screen than any
                  we target. */}
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 sm:px-4">Week</TableHead>
                      {USAGE_SERIES.map((series) => (
                        <TableHead key={series.key} className="px-2 text-right sm:px-4">
                          {series.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeks.map((week) => (
                      <TableRow key={week.week_start}>
                        <TableCell className="px-2 whitespace-normal sm:px-4 sm:whitespace-nowrap">
                          {weekOfLabel(week.week_start)}
                          {week.week_start === latest?.week_start ? (
                            <span className="text-muted-foreground"> {USAGE_LATEST_NOTE}</span>
                          ) : null}
                        </TableCell>
                        {USAGE_SERIES.map((series) => (
                          <TableCell
                            key={series.key}
                            className="px-2 text-right sm:px-4"
                            data-numeric
                          >
                            {formatCount(week[series.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
