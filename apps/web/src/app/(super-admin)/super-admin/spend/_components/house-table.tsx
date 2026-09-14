import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuperAdminSpend } from "@/lib/api/super-admin-spend";
import { formatCount } from "@/lib/charts";
import { plural } from "@/lib/hq-overview";
import {
  allocatedFixedCostTotal,
  fixedCostPerHousePerMonth,
  formatUsd,
  perActiveMemberNote,
} from "@/lib/hq-spend";

/**
 * Every house that spent anything, dearest first, with every column the API
 * derives.
 *
 * SETTLED AND ESTIMATED ARE TWO COLUMNS, never one. A row whose SMS cost is
 * entirely an estimate and a row Twilio has fully invoiced are different kinds of
 * fact, and a single "SMS cost" column would let an operator price the product
 * against a list rate without knowing they had. The "Priced" column says how much
 * of each row is real, and a house with rows past Twilio's retention wears a
 * sticker: those will stay estimates for good, so the operator can stop waiting
 * for them.
 *
 * THE ALLOCATED FIXED COST HAS ITS OWN COLUMN and is never added into `Total`,
 * because it is an allocation and not a charge this house incurred. The column
 * only appears when a fixed cost is configured — an empty column of dashes would
 * read as "hosting is free", which is the one thing the plan's Fixed costs
 * decision exists to prevent.
 *
 * THE HEADLINE COLUMNS COME FIRST: total, per housemate, housemates, then the
 * breakdown. This table is wider than the card at any viewport — it is eleven
 * columns of an operator console — so it scrolls inside its own container rather
 * than taking the page sideways with it. What must never be behind that scroll
 * is the column the rows are SORTED BY and the figure a reader came for, so the
 * order is "what did it cost, per whom" and then "what was it spent on".
 *
 * SEGMENTS RIDE WITH TEXTS and TOKENS WITH CALLS, as a second line in the same
 * cell rather than three columns of their own. Every figure the API derives is
 * still here — nothing is dropped — but fourteen columns pushed Total, which is
 * the column the table is SORTED BY and the one figure a reader came for, off
 * the right edge at 1440 and behind a scrollbar nobody would think to drag.
 * Segments only ever mean anything next to the texts they came from, and tokens
 * next to the calls, so folding them in loses nothing and buys back the headline.
 *
 * The totals row is not decoration either: it is how a reader checks that the
 * table they are reading adds up to the chart they just read.
 *
 * Sorted by Rails, not here. The order is part of the payload's contract (dearest
 * first, ties broken by name), and a second sort on this side is a second answer
 * to "which house costs most".
 */
export function HouseTable({ spend }: { spend: SuperAdminSpend }) {
  const showFixed = spend.fixed_monthly_cost_usd !== null;
  const fixedTotal = allocatedFixedCostTotal(spend);
  const fixedPerMonth = fixedCostPerHousePerMonth(spend);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Every house</CardTitle>
        <CardDescription>
          {formatCount(spend.houses_with_spend)} of {formatCount(spend.houses_total)}{" "}
          {plural(spend.houses_total, "house", "houses")} spent anything in this window. The rest
          cost nothing at all and are not listed.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {spend.houses.length === 0 ? (
          <p className="text-muted-foreground bg-muted/60 rounded-xl px-4 py-6 text-center text-sm text-pretty">
            No house has sent a text or classified a title in this window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>House</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Per housemate</TableHead>
                <TableHead className="text-right">Housemates</TableHead>
                <TableHead className="text-right">Texts sent</TableHead>
                <TableHead className="text-right">Priced</TableHead>
                <TableHead className="text-right">Texts, settled</TableHead>
                <TableHead className="text-right">Texts, estimated</TableHead>
                <TableHead className="text-right">Claude calls</TableHead>
                <TableHead className="text-right">Claude</TableHead>
                {showFixed ? <TableHead className="text-right">Fixed cost share</TableHead> : null}
              </TableRow>
            </TableHeader>

            <TableBody>
              {spend.houses.map((house) => (
                <TableRow key={house.group_id}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{house.name}</span>
                    <span className="text-muted-foreground block text-xs">{house.slug}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium" data-numeric>
                    {formatUsd(house.total)}
                  </TableCell>
                  {/* Null is "nobody to divide by", said in words. Not a dash,
                      which reads as a figure somebody forgot to fill in, and
                      never $0.00, which reads as a house that costs nothing. */}
                  <TableCell
                    className={
                      house.total_per_active_member === null
                        ? "text-muted-foreground text-right text-xs"
                        : "text-right"
                    }
                    data-numeric={house.total_per_active_member === null ? undefined : true}
                  >
                    {perActiveMemberNote(house)}
                  </TableCell>
                  <TableCell className="text-right" data-numeric>
                    {formatCount(house.active_members)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <span data-numeric>{formatCount(house.texts_sent)}</span>
                    <span className="text-muted-foreground block text-xs" data-numeric>
                      {formatCount(house.segments)}{" "}
                      {plural(house.segments, "segment", "segments")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <span data-numeric>
                      {formatCount(house.texts_settled)} of {formatCount(house.texts_sent)}
                    </span>
                    {house.texts_unpriceable > 0 ? (
                      <Badge variant="warning" className="ml-1.5 align-middle">
                        {formatCount(house.texts_unpriceable)} never
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right" data-numeric>
                    {formatUsd(house.sms_cost_settled)}
                  </TableCell>
                  <TableCell className="text-right" data-numeric>
                    {formatUsd(house.sms_cost_estimated)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <span data-numeric>{formatCount(house.claude_calls)}</span>
                    <span className="text-muted-foreground block text-xs" data-numeric>
                      {formatCount(house.claude_tokens_in)} in, {formatCount(house.claude_tokens_out)}{" "}
                      out
                    </span>
                  </TableCell>
                  <TableCell className="text-right" data-numeric>
                    {formatUsd(house.claude_cost)}
                  </TableCell>
                  {showFixed ? (
                    <TableCell className="text-muted-foreground text-right" data-numeric>
                      {house.allocated_fixed_cost === null
                        ? "none set"
                        : formatUsd(house.allocated_fixed_cost)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>

            <TableFooter>
              <TableRow>
                <TableCell className="whitespace-nowrap">Every house</TableCell>
                <TableCell className="text-right font-medium" data-numeric>
                  {formatUsd(spend.totals.total)}
                </TableCell>
                <TableCell className="text-right" />
                <TableCell className="text-right" />
                <TableCell className="text-right whitespace-nowrap">
                  <span data-numeric>{formatCount(spend.totals.texts_sent)}</span>
                  <span className="text-muted-foreground block text-xs" data-numeric>
                    {formatCount(spend.totals.segments)} segments
                  </span>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap" data-numeric>
                  {formatCount(spend.totals.texts_settled)} of{" "}
                  {formatCount(spend.totals.texts_sent)}
                </TableCell>
                <TableCell className="text-right" data-numeric>
                  {formatUsd(spend.totals.sms_cost_settled)}
                </TableCell>
                <TableCell className="text-right" data-numeric>
                  {formatUsd(spend.totals.sms_cost_estimated)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <span data-numeric>{formatCount(spend.totals.claude_calls)}</span>
                  <span className="text-muted-foreground block text-xs" data-numeric>
                    {formatCount(spend.totals.claude_tokens_in)} in,{" "}
                    {formatCount(spend.totals.claude_tokens_out)} out
                  </span>
                </TableCell>
                <TableCell className="text-right" data-numeric>
                  {formatUsd(spend.totals.claude_cost)}
                </TableCell>
                {showFixed ? (
                  // The COLUMN'S total, summed from the shares above it, because
                  // that is the only figure a totals row can be checked against.
                  // It used to print the configured monthly cost, which is a
                  // different number in a different unit sitting under a column
                  // of window-length allocations — a totals row that did not
                  // total its column.
                  <TableCell className="text-right whitespace-nowrap" data-numeric>
                    {fixedTotal === null ? null : formatUsd(fixedTotal)}
                    {fixedPerMonth === null ? null : (
                      <span className="text-muted-foreground block text-xs">
                        ({formatUsd(fixedPerMonth)} a month each)
                      </span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            </TableFooter>
          </Table>
        )}

        {spend.houses.length === 0 ? null : (
          <p className="text-muted-foreground mt-4 text-xs text-pretty">
            Every column the API derives is in this table; scroll it sideways for the per-vendor
            breakdown. The allocated fixed cost is a column of its own and is never added into
            Total — it is an allocation, not a charge any house incurred.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
