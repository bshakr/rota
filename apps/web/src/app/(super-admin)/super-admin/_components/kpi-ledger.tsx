import { ArrowRightLeft, House, MessageSquare, Sparkles, TriangleAlert } from "lucide-react";

import { LedgerTile } from "@/components/ledger-tile";
import type { OverviewKpis } from "@/lib/api/super-admin-overview";
import { deliveryRateNote } from "@/lib/hq-overview";

/**
 * The five figures the operator came for, as the house dashboard's ledger tiles.
 *
 * Same component, same coin, same numeral — HQ is the same product seen from the
 * other side, and a second tile design would say otherwise.
 *
 * Two tiles carry a second line, and both carry it for the same reason: a number
 * on its own here would be misleading. The texts tile publishes the delivery
 * rate WITH its denominator, because 96.4% of twelve and 96.4% of four hundred
 * are different facts. The failures tile says what a failure actually cost, in
 * the semantic "went wrong" ink, and says nothing at all when there were none —
 * a week with no failures should look like a quiet tile, not a green tick.
 */
export function KpiLedger({ kpis }: { kpis: OverviewKpis }) {
  const failed = kpis.texts_failed_last_7_days;

  return (
    <ul className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <LedgerTile
        icon={House}
        coin="peach"
        value={kpis.houses_total}
        label={kpis.houses_total === 1 ? "house" : "houses"}
        note={`${kpis.houses_active_last_30_days} active in 30 days`}
      />
      <LedgerTile
        icon={Sparkles}
        coin="mint"
        value={kpis.houses_new_this_week}
        label="new this week"
      />
      <LedgerTile
        icon={MessageSquare}
        coin="sky"
        value={kpis.texts_last_7_days}
        label="texts, last 7 days"
        note={deliveryRateNote(kpis.delivery_rate_last_7_days, kpis.texts_settled_last_7_days)}
      />
      <LedgerTile
        icon={ArrowRightLeft}
        coin="lilac"
        value={kpis.covers_this_week}
        label="covers this week"
      />
      <LedgerTile
        icon={TriangleAlert}
        coin="blush"
        value={failed}
        label="failures, last 7 days"
        note={failed > 0 ? "somebody was owed a reminder" : undefined}
        noteTone="alert"
      />
    </ul>
  );
}
