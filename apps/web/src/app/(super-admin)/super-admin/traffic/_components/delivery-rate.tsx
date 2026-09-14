import { Sparkline } from "@/components/charts/sparkline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrafficWeek } from "@/lib/api/super-admin-traffic";
import { formatCount } from "@/lib/charts";
import { formatRate, plural } from "@/lib/hq-overview";
import { weekLabel, weekOfLabel } from "@/lib/hq-traffic";

/**
 * Did the texts arrive? One line, one week per point.
 *
 * TWO DECISIONS, both of them about not lying with a line:
 *
 *   - The scale runs 0 to 100, not from the data's own minimum to its maximum.
 *     A delivery rate lives between 94 and 99, and auto-scaling that into the
 *     full height of the box turns a two-point dip into a collapse. Drawn
 *     against the whole scale, a flat line near the top is what a healthy week
 *     looks like — and a real collapse is unmistakable.
 *   - A week where nothing settled is a GAP. Rails sends null rather than zero
 *     for it, because "no texts that week" and "none of them arrived" are
 *     opposite facts, and a line dropping to the floor would say the second.
 *
 * The headline is the most recent week that actually settled anything, printed
 * with its denominator: 96.4% of twelve texts and 96.4% of four hundred are
 * different facts. No range-wide average is invented here — every figure on this
 * page is one Rails computed.
 */
export function DeliveryRate({ weeks }: { weeks: readonly TrafficWeek[] }) {
  const points = weeks.map((week) => ({
    label: weekOfLabel(week.week_starting),
    value: week.delivery_rate,
  }));

  const latest = [...weeks].reverse().find((week) => week.delivery_rate !== null) ?? null;
  const quiet = weeks.filter((week) => week.delivery_rate === null).length;
  const first = weeks.at(0);
  const last = weeks.at(-1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery rate</CardTitle>
        <CardDescription>
          Delivered as a share of the texts whose fate is settled — delivered plus failed. Texts
          still in flight are left out, so the line does not sag every hour as the sweep lays down a
          new batch.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <p className="flex items-baseline gap-2">
          <span
            className="font-heading text-foreground text-3xl leading-none font-semibold"
            data-numeric
          >
            {latest === null || latest.delivery_rate === null
              ? "—"
              : formatRate(latest.delivery_rate)}
          </span>
          <span className="text-muted-foreground text-xs">
            {latest === null
              ? "nothing has settled in this window"
              : `of ${formatCount(latest.texts_settled)} settled, week of ${weekLabel(latest.week_starting)}`}
          </span>
        </p>

        <div className="mt-4">
          <Sparkline
            points={points}
            domain={{ max: 100 }}
            label={`Delivery rate by week, ${points.length} ${plural(points.length, "week", "weeks")}, drawn against a full 0 to 100% scale`}
            className="h-14"
          />
          {/* Two labels, not thirteen: the ends are what a sparkline's axis
              needs, and a label under every point at 390px is a smudge. */}
          <p className="text-muted-foreground mt-1.5 flex justify-between text-[11px]">
            <span>{first ? weekLabel(first.week_starting) : null}</span>
            <span>{last ? weekLabel(last.week_starting) : null}</span>
          </p>
        </div>

        <p className="text-muted-foreground mt-4 text-xs text-pretty">
          {quiet > 0
            ? `${quiet} ${plural(quiet, "week has", "weeks have")} a gap in the line: nothing settled that week, which is not the same as nothing arriving.`
            : "Every week in this window settled something, so the line has no gaps."}
        </p>
      </CardContent>
    </Card>
  );
}
