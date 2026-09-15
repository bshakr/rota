import { PageHeader } from "@/components/page-header";
import type { SuperAdminTraffic } from "@/lib/api/super-admin-traffic";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { RANGE_LABELS } from "@/lib/hq-traffic";

import { ConversionAside } from "./conversion-aside";
import { ConversionFunnel } from "./conversion-funnel";
import { DeliveryRate } from "./delivery-rate";
import { FailuresCard } from "./failures-card";
import { RangePicker } from "./range-picker";
import { VisitsPanel } from "./visits-panel";
import { WeeklySignals } from "./weekly-signals";
import { WeeklyTexts } from "./weekly-texts";

/**
 * The traffic dashboard, in the plan's two halves: is the product CONVERTING,
 * and is it doing anything for the houses that made it through?
 *
 * Conversion sits at the top because it is the question that decides what to
 * build next; usage sits under it because it is the question that decides
 * whether anything is on fire. The funnel gets the wider column — it is eight
 * bars and two units of measurement — and the two figures a funnel cannot answer
 * ride beside it.
 *
 * Takes its payload and its clock as arguments and fetches nothing, exactly as
 * `OverviewScreen` does. That is what lets the page own the request and the
 * error state while this owns the layout, and what makes the screen renderable
 * from a fixture — which is how its screenshots are taken, since the real page
 * is behind AuthKit and an allowlist.
 *
 * One column below `lg`, which is what makes it work on a phone: the grids stop
 * being grids and every card was already full-width inside its column.
 */
export function TrafficScreen({ traffic, now }: { traffic: SuperAdminTraffic; now: Date }) {
  const generatedAt = new Date(traffic.generated_at);

  return (
    <>
      <PageHeader
        title="Traffic"
        description={`Conversion and usage across every house, over the last ${RANGE_LABELS[traffic.range].toLowerCase()}.`}
        actions={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <RangePicker range={traffic.range} />
            {/* The INSTANT, not the relative string. The payload is cached for a
                minute, so "counted just now" is what a relative line would say on
                every single load — including the load where Rails has been down
                for an hour and is serving a stale entry. The relative phrasing
                keeps its job as the hover title. */}
            <time
              className="text-muted-foreground text-xs"
              dateTime={traffic.generated_at}
              title={`Counted ${relativeTime(generatedAt, now)}`}
            >
              Counted {formatTimestamp(generatedAt)}
            </time>
          </div>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ConversionFunnel funnel={traffic.funnel} uniqueVisitors={traffic.visits.unique_visitors} />
        <ConversionAside
          median={traffic.median_hours_to_first_text}
          sample={traffic.median_hours_sample}
          signedInWithoutHouse={traffic.signed_in_without_house}
        />
      </div>

      {/* Directly under the funnel, and full width, because it is step 1 taken
          apart: the bar says how many arrived, this says where from. Anywhere
          else on the page and it would read as a fourth usage chart. */}
      <div className="mt-6 grid items-start gap-6">
        <VisitsPanel visits={traffic.visits} views={traffic.funnel[0].count ?? 0} />
      </div>

      <h2 className="font-heading mt-10 mb-4 text-lg font-semibold">Usage</h2>

      <div className="grid items-start gap-6">
        <WeeklyTexts weeks={traffic.weeks} />

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <DeliveryRate weeks={traffic.weeks} />
          <FailuresCard failures={traffic.failures} />
        </div>

        <WeeklySignals weeks={traffic.weeks} />
      </div>

      <p className="text-muted-foreground mt-8 text-xs text-pretty">
        Weeks begin on a Monday, UTC, and <strong className="font-semibold">both ends of every
        range are partial buckets</strong>: no range is snapped to a Monday, so the oldest bucket
        starts mid-week, and the newest runs from Monday to now rather than to Sunday. Every chart
        here headlines that newest bucket, so it is always a week in progress — a bar or a figure
        that claimed either end was a whole week would be lying. Every figure is counted live across
        all houses and cached for a minute.
      </p>
    </>
  );
}
