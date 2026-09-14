import { PageHeader } from "@/components/page-header";
import type { SuperAdminOverview } from "@/lib/api/super-admin-overview";
import type { OverviewSpend } from "@/lib/api/super-admin-spend";
import { formatTimestamp, relativeTime } from "@/lib/date";

import { AttentionList } from "./attention-list";
import { KpiLedger } from "./kpi-ledger";
import { RecentHouses } from "./recent-houses";
import { SpendTile } from "./spend-tile";
import { SystemHealth } from "./system-health";

/**
 * The operator's landing screen, top to bottom: the ledger of counts, then the
 * work (houses that need a human) beside the context (who just arrived, whether
 * the machinery is running, what it costs).
 *
 * The attention list gets the wider column because it is the only thing on this
 * page anyone DOES something about; the rest is there to be glanced at.
 *
 * Takes its payload and its clock as arguments and fetches nothing. That is what
 * lets the page own the request and the error state while this owns the layout —
 * and what makes the screen renderable from a fixture, which is how its
 * screenshots are taken.
 *
 * One column below `lg`, which is what makes it work on a phone: the grid simply
 * stops being a grid, and every card was already full-width inside its column.
 */
export function OverviewScreen({
  overview,
  spend,
  now,
}: {
  overview: SuperAdminOverview;
  /**
   * The spend tile's four figures, or null when they could not be counted. A
   * SECOND payload, fetched by the page beside the overview — the overview's own
   * `spend` key is still Rails' placeholder. See ./spend-tile.tsx.
   */
  spend: OverviewSpend | null;
  now: Date;
}) {
  const generatedAt = new Date(overview.generated_at);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every house on Rota Monster: how they are doing, what they send, and what needs a human."
        actions={
          // Not decoration. The payload is cached for a minute, so a figure that
          // has not moved since the last look needs to say whether it is calm or
          // simply the same cached copy.
          //
          // The INSTANT, not the relative string. Under a 60-second cache
          // "Counted just now" is what this line says on every single load,
          // including the load where Rails has been down for an hour and is
          // serving a stale entry — a clock that always reads the same time is
          // not a clock. The relative phrasing keeps its job as the hover title,
          // where it answers "how long ago was that?" without having to be right
          // to the second.
          <time
            className="text-muted-foreground text-xs"
            dateTime={overview.generated_at}
            title={`Counted ${relativeTime(generatedAt, now)}`}
          >
            Counted {formatTimestamp(generatedAt)}
          </time>
        }
      />

      <KpiLedger kpis={overview.kpis} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Two stacks rather than a 2x2 grid: the attention list is the one card
            whose height is unbounded (fifty rows on a bad week), and a grid row
            would make every card beside it inherit that height as whitespace. The
            quiet spend tile rides under it so neither column is left dangling
            when the list is short, which is most days. */}
        <div className="grid gap-6">
          <AttentionList rows={overview.attention} total={overview.attention_total} />
          <SpendTile spend={spend} />
        </div>

        <div className="grid gap-6">
          <RecentHouses houses={overview.recent_houses} now={now} />
          <SystemHealth health={overview.system_health} now={now} />
        </div>
      </div>

      <p className="text-muted-foreground mt-8 text-xs text-pretty">
        Every figure here is counted live across all houses and cached for a minute. Traffic and
        Spend get their own pages; the nav says which of them exist yet.
      </p>
    </>
  );
}
