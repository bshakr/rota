import { type BarDatum, Bars } from "@/components/charts/bars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrafficFunnelRow } from "@/lib/api/super-admin-traffic";
import { TRAFFIC_STEP_LABELS, funnelRateNote, visitorsClause } from "@/lib/hq-traffic";

/**
 * The plan's eight steps, as bars, each with what it counts and how it did
 * against the step above it.
 *
 * Three things this chart refuses to smooth over, because each of them is the
 * fact an operator needs:
 *
 *   1. STEP 1 IS A BROWSER COUNT. Landing views are the `landing_view` events
 *      the homepage's own script posts, so a crawler or a visitor with
 *      JavaScript off is not in the bar. It UNDERCOUNTS, and the API's note says
 *      so under it rather than leaving the figure to be read as a server log.
 *   2. THE UNIT CHANGES AT STEP 3. Step 2 counts PEOPLE who signed in;
 *      everything below counts HOUSES. That is the plan's funnel, not a slip, so
 *      every bar prints its own unit rather than leaving the reader to assume a
 *      single one.
 *   3. A RATE CAN EXCEED 100%. Step 4 does it routinely — `timezone_confirmed_at`
 *      is re-stamped on every settings save, so an established house lands there
 *      without ever having been in step 3's count. Shown and explained, never
 *      capped.
 *   4. "VISITORS" ON STEP 1 MEANS BROWSER-DAYS. The clause beside the bar counts
 *      views that were a browser's first that day, from a code thrown away at
 *      midnight, so somebody who came back on another day is two. What that word
 *      means is spelled out ONCE on the page, under the visits panel, beside the
 *      standalone form of the same figure. Saying it twice, once here and once
 *      four hundred pixels down, taught a reader that the page repeats itself.
 *
 * Bar lengths are measured against the LONGEST step rather than against step 1,
 * which is the only honest choice when a later step can be bigger than an
 * earlier one.
 */
export function ConversionFunnel({
  funnel,
  uniqueVisitors,
}: {
  funnel: readonly TrafficFunnelRow[];
  uniqueVisitors: number;
}) {
  const items: BarDatum[] = funnel.map((step, index) => {
    const above = index === 0 ? null : funnel[index - 1];
    const rate = funnelRateNote(
      step.rate_from_previous,
      above
        ? { label: TRAFFIC_STEP_LABELS[above.key], tracked: above.tracked, count: above.count }
        : null,
    );

    // Step 1 only, because it is the only bar that counts VISITS and therefore
    // the only one where "and how many browsers was that?" is a question. It
    // takes the slot the rate would have had, which step 1 has nothing above it
    // to fill.
    //
    // The CLAUSE, not the sentence: the bar has just printed "1,420 views" and a
    // footnote opening with the same number twenty pixels under it reads as two
    // figures rather than one. The panel below the funnel prints the standalone
    // form, where nothing has said the count yet.
    const visitors = index === 0 ? visitorsClause(step.count ?? 0, uniqueVisitors) : null;

    return {
      label: `${step.step}. ${TRAFFIC_STEP_LABELS[step.key]}`,
      value: step.count,
      unit: step.unit,
      // All of them, when there are all of them. Rails attaches a note to say
      // what a step COUNTED, which is a different thing from how it converted,
      // so a step that grows a note later must not lose it to the presence of a
      // rate. The note is quoted rather than paraphrased, so the page and the
      // payload cannot end up claiming different things about the same bar.
      note: [rate, visitors, step.note].filter(Boolean).join(" · ") || undefined,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion</CardTitle>
        <CardDescription>
          How far the people who arrived in this window got, step by step. Steps 1 and 2 count
          people; from step 3 down, every figure is houses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Bars items={items} tone="grape" />

        <p className="text-muted-foreground mt-6 text-xs text-pretty">
          Each step counts arrivals inside this window, so a rate can pass 100%: a house made by
          somebody who signed in last month lands below a step they were never counted in, and
          confirming a timezone is re-stamped every time a house saves its settings.
        </p>
      </CardContent>
    </Card>
  );
}
