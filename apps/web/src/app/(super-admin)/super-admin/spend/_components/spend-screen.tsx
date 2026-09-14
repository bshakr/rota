import { Coins, House, MessageSquare, Sparkles, TriangleAlert } from "lucide-react";

import { LedgerTile } from "@/components/ledger-tile";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SuperAdminSpend } from "@/lib/api/super-admin-spend";
import { formatCount } from "@/lib/charts";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { plural } from "@/lib/hq-overview";
import {
  SPEND_RANGE_LABELS,
    formatUsd,
  marginInputs,
  otherCurrenciesNote,
} from "@/lib/hq-spend";

import { HouseTable } from "./house-table";
import { MarginCalculator } from "./margin-calculator";
import { MonthlyTotals } from "./monthly-totals";
import { RangePicker } from "./range-picker";
import { UnitEconomics } from "./unit-economics";

/**
 * The spend screen, top to bottom: what it all came to, where it went month by
 * month, what a house costs, what a price would leave, and then every house.
 *
 * The order is the pricing conversation in the order it actually happens. The
 * ledger answers "how much"; the chart answers "is it growing"; the unit
 * economics answer "per what"; the calculator answers "so what price"; the table
 * is where the argument gets checked.
 *
 * Takes its payload and its clock as arguments and fetches nothing. That is what
 * lets the page own the request and the error state while this owns the layout —
 * and what makes the screen renderable from a fixture, which is how its
 * screenshots are taken.
 *
 * One column below `lg`, which is what makes it work on a phone: the grid simply
 * stops being a grid, every card was already full-width inside its column, and
 * the one wide thing on the page — the house table — scrolls inside its own card
 * rather than taking the page sideways with it.
 */
export function SpendScreen({ spend, now }: { spend: SuperAdminSpend; now: Date }) {
  const countedAt = new Date(spend.ends_at);
  const currencies = otherCurrenciesNote(spend.totals);

  return (
    <>
      <PageHeader
        title="Spend"
        description="What every house costs to run, in texts and Claude calls, so the product can be priced against a real number."
        actions={<RangePicker range={spend.range} />}
      />

      {/* Not decoration. The payload is cached for a minute, so a figure that has
          not moved since the last look needs to say whether it is calm or simply
          the same cached copy. The INSTANT, not the relative string: under a
          60-second cache "counted just now" is what a relative line would say on
          every single load, including the load where Rails has been down for an
          hour and is serving a stale entry. */}
      <p className="text-muted-foreground -mt-4 mb-6 text-xs">
        <time dateTime={spend.ends_at} title={`Counted ${relativeTime(countedAt, now)}`}>
          Counted {formatTimestamp(countedAt)}
        </time>
        , across the last {SPEND_RANGE_LABELS[spend.range]}. Every figure is {spend.currency}, at the
        precision it was computed.
      </p>

      {currencies === null ? null : (
        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Not every charge is in {spend.currency}</AlertTitle>
          <AlertDescription>{currencies}</AlertDescription>
        </Alert>
      )}

      <ul className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <LedgerTile
          icon={Coins}
          coin="lemon"
          value={formatUsd(spend.totals.total)}
          label="spent in this window"
          note={`${formatCount(spend.totals.texts_sent)} ${plural(spend.totals.texts_sent, "text", "texts")}, ${formatCount(spend.totals.claude_calls)} Claude ${plural(spend.totals.claude_calls, "call", "calls")}`}
        />
        <LedgerTile
          icon={MessageSquare}
          coin="sky"
          value={formatUsd(spend.totals.sms_cost)}
          label="texts"
          note={`${formatCount(spend.totals.segments)} ${plural(spend.totals.segments, "segment", "segments")} sent`}
        />
        <LedgerTile
          icon={Sparkles}
          coin="mint"
          value={formatUsd(spend.totals.claude_cost)}
          label="Claude"
          note={`${formatCount(spend.totals.titles_classified)} ${plural(spend.totals.titles_classified, "title", "titles")} classified`}
        />
        <LedgerTile
          icon={House}
          coin="peach"
          value={formatCount(spend.houses_with_spend)}
          label={`of ${formatCount(spend.houses_total)} ${plural(spend.houses_total, "house", "houses")} spent anything`}
          note={
            spend.fixed_monthly_cost_usd === null
              ? "no fixed monthly cost configured"
              : `${formatUsd(spend.fixed_monthly_cost_usd)} a month in fixed costs, split across them`
          }
        />
      </ul>

      <div className="grid gap-6">
        <MonthlyTotals spend={spend} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <UnitEconomics spend={spend} />
          <MarginCalculator inputs={marginInputs(spend)} currency={spend.currency} />
        </div>

        <HouseTable spend={spend} />
      </div>

      <p className="text-muted-foreground mt-8 text-xs text-pretty">
        A failed text that Twilio rejected at submission costs nothing and is not counted here; a
        text delivered to a wrong number costs exactly what a right one does and is. Every figure is
        counted live across all houses and cached for a minute.
      </p>
    </>
  );
}
