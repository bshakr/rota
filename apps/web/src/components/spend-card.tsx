import { Wallet } from "lucide-react";

import { StackedBars } from "@/components/charts/stacked-bars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/charts";
import {
  type HouseSpendWindow,
  SPEND_RANGE_LABELS,
  SPEND_SERIES,
  activeMembersNote,
    formatUsd,
  monthsCoveredNote,
  perActiveMemberNote,
  pricingNote,
} from "@/lib/hq-spend";

/**
 * WHAT ONE HOUSE COSTS — the spend card for the group dashboard.
 *
 * ## Not wired into a page yet, on purpose
 *
 * The group dashboard at `/super-admin/groups/[id]` belongs to
 * https://linear.app/bloombase/issue/BLO-1676 and is not on main at the time of
 * writing. This ticket (https://linear.app/bloombase/issue/BLO-1684) owns the
 * card and its data helper, so the two can land in either order; the group page
 * drops it in with three lines and no new plumbing. It is exported and
 * documented rather than hidden behind a flag, because a component nobody can
 * find is a component somebody rebuilds.
 *
 * ## How to feed it
 *
 * ```tsx
 * import { getSpend } from "@/lib/api/super-admin";
 * import { houseSpend } from "@/lib/hq-spend";
 *
 * const spend = houseSpend(await getSpend("90d"), group.id);
 * <SpendCard spend={spend} houseName={group.name} />
 * ```
 *
 * THERE IS NO PER-GROUP SPEND ENDPOINT. `SuperAdmin::Spend` answers for every
 * house at once and is cached for a minute in Rails, so one house's figures are
 * read out of the same payload the spend page draws — the right trade at tens of
 * houses, and it means the group card and the spend page can never disagree
 * about what a house cost. Ninety days is the window the plan asks this card for
 * ("this month and the last three").
 *
 * ## What it cannot show, and says so
 *
 * The plan asks for per-month bars here. The payload cannot produce them: its
 * `months` are the WHOLE PRODUCT month by month and its `houses` are each house
 * over the whole window, and there is no per-house-per-month cell in between.
 * Splitting one house's spend by month is an API change, not a web one — so this
 * card draws the window total split by what it was spent on, names the months
 * that total covers, and does not invent four bars. Drawing the product's
 * monthly series inside a card about one house would be worse than drawing
 * nothing: it would look exactly like this house's history.
 */
export function SpendCard({
  spend,
  houseName,
}: {
  /** One house filtered out of the spend payload — see `houseSpend` in lib/hq-spend.ts. */
  spend: HouseSpendWindow;
  /** The house's name, for the sentence it gets when it has spent nothing at all. */
  houseName: string;
}) {
  const house = spend.house;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="bg-lemon grid size-7 shrink-0 place-items-center rounded-full" aria-hidden>
            <Wallet className="text-plum size-3.5" strokeWidth={2.5} />
          </span>
          Spend
        </CardTitle>
        <CardDescription>
          {monthsCoveredNote(spend.months)} — the last {SPEND_RANGE_LABELS[spend.range]}, in{" "}
          {spend.currency}.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {house === null ? (
          <p className="text-muted-foreground bg-muted/60 rounded-xl px-4 py-6 text-center text-sm text-pretty">
            {houseName} has sent no texts and classified no titles in this window, so it has cost
            nothing at all.
          </p>
        ) : (
          <>
            <div className="mb-5 flex items-baseline justify-between gap-3">
              <span
                className="font-heading text-foreground text-2xl leading-none font-semibold"
                data-numeric
              >
                {formatUsd(house.total)}
              </span>
              <span className="text-muted-foreground text-xs">
                {formatCount(house.texts_sent)} {house.texts_sent === 1 ? "text" : "texts"},{" "}
                {formatCount(house.claude_calls)} Claude{" "}
                {house.claude_calls === 1 ? "call" : "calls"}
              </span>
            </div>

            {/* One row per thing the money went on rather than one row per month:
                see the note on this component. Each row is a single-segment bar,
                so the three are scaled against each other and the split reads at
                a glance. */}
            <StackedBars
              formatValue={formatUsd}
              items={SPEND_SERIES.map((series) => ({
                label: series.label,
                value: house[series.key],
                segments: [
                  {
                    key: series.key,
                    label: series.label,
                    value: house[series.key],
                    tone: series.tone,
                  },
                ],
              }))}
            />

            <dl className="bg-muted/60 mt-5 rounded-xl px-4 py-3.5">
              <dt className="text-muted-foreground text-xs">Per housemate, this window</dt>
              {/* Null is "nobody to divide by", said in words at the size of
                  words. A house with nobody left on the roll has no cost per
                  person, and "$0.00" in a 20px numeral would read as a free
                  house rather than an empty one. */}
              {house.total_per_active_member === null ? (
                <dd className="text-muted-foreground mt-1 text-sm">no active members</dd>
              ) : (
                <dd
                  className="font-heading text-foreground mt-1 text-xl leading-none font-semibold"
                  data-numeric
                >
                  {perActiveMemberNote(house)}
                </dd>
              )}
              <dd className="text-muted-foreground mt-1.5 text-xs">
                {activeMembersNote(house)} on the roll today
              </dd>
            </dl>

            <p className="text-muted-foreground mt-4 text-xs text-pretty">
              {pricingNote(house, spend.estimatedSegmentCost)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
