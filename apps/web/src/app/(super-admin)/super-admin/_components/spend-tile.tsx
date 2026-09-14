import Link from "next/link";
import { Wallet } from "lucide-react";

import { isSuperAdminSurfaceReady } from "@/components/super-admin-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewSpend } from "@/lib/api/super-admin-spend";
import { SPEND_RANGE_LABELS, formatUsd, monthLabel } from "@/lib/hq-spend";

const SPEND_HREF = "/super-admin/spend";

/**
 * The spend tile: this month so far, split texts and Claude, beside last month
 * whole.
 *
 * The figures do NOT come from the overview payload. `overview.spend` is still
 * null there — Rails keeps its placeholder — so the overview PAGE fetches the
 * spend window alongside the overview and derives these four numbers from it
 * (`overviewSpend`, src/lib/hq-spend.ts). The tile takes them as a prop and
 * fetches nothing, which is what lets it be rendered from a fixture and what
 * keeps the page owning every request on the screen.
 *
 * THE TWO MONTHS ARE NOT THE SAME LENGTH and the tile says so rather than
 * inviting the comparison. A month that is four days old is not down on the last
 * one; it is four days old. There is no trend arrow here for exactly that
 * reason — a percentage between a partial month and a whole one is a number that
 * is wrong for twenty-nine days out of thirty.
 *
 * A placeholder "$0.00" on a cost tile is the single most expensive lie this
 * screen could tell, so the null branch says what it does not know instead.
 *
 * Whether it links anywhere is not decided here. It asks the nav, which is the
 * one list that knows which surfaces exist — so the flag and the link move
 * together, with nothing else to remember.
 */
export function SpendTile({ spend }: { spend: OverviewSpend | null }) {
  const ready = isSuperAdminSurfaceReady(SPEND_HREF);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="bg-lemon grid size-7 shrink-0 place-items-center rounded-full" aria-hidden>
            <Wallet className="text-plum size-3.5" strokeWidth={2.5} />
          </span>
          Spend
        </CardTitle>
        <CardDescription>Texts and Claude, this month against last.</CardDescription>
      </CardHeader>

      <CardContent>
        {spend === null ? (
          <p className="text-muted-foreground bg-muted/60 rounded-xl px-4 py-6 text-center text-sm text-pretty">
            No spend figures right now — the count did not come back.{" "}
            {ready ? (
              <Link
                href={SPEND_HREF}
                className="text-link font-medium underline-offset-4 hover:underline"
              >
                Try the spend page
              </Link>
            ) : (
              "Nothing is being counted here yet."
            )}
          </p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="bg-muted/60 rounded-xl px-4 py-3.5">
                <dt className="text-muted-foreground text-xs">
                  {monthLabel(spend.this_month.month)}, so far
                </dt>
                <dd
                  className="font-heading text-foreground mt-1 text-2xl leading-none font-semibold"
                  data-numeric
                >
                  {formatUsd(spend.this_month.total)}
                </dd>
                <dd className="text-muted-foreground mt-1.5 text-xs">
                  <span data-numeric>{formatUsd(spend.this_month.sms_cost)}</span> texts,{" "}
                  <span data-numeric>{formatUsd(spend.this_month.claude_cost)}</span> Claude
                </dd>
              </div>

              <div className="bg-muted/60 rounded-xl px-4 py-3.5">
                <dt className="text-muted-foreground text-xs">
                  {spend.last_month === null
                    ? "Last month"
                    : `${monthLabel(spend.last_month.month)}, whole`}
                </dt>
                <dd
                  className="font-heading text-foreground mt-1 text-2xl leading-none font-semibold"
                  data-numeric
                >
                  {spend.last_month === null ? "none yet" : formatUsd(spend.last_month.total)}
                </dd>
                <dd className="text-muted-foreground mt-1.5 text-xs">
                  {spend.last_month === null ? (
                    "No whole month to compare with yet."
                  ) : (
                    <>
                      <span data-numeric>{formatUsd(spend.last_month.sms_cost)}</span> texts,{" "}
                      <span data-numeric>{formatUsd(spend.last_month.claude_cost)}</span> Claude
                    </>
                  )}
                </dd>
              </div>
            </dl>

            <p className="text-muted-foreground mt-3 text-xs text-pretty">
              This month is still running, so it is not a like-for-like comparison. Every figure is{" "}
              {spend.currency}, read from the last {SPEND_RANGE_LABELS[spend.range]}.{" "}
              {ready ? (
                <Link
                  href={SPEND_HREF}
                  className="text-link font-medium underline-offset-4 hover:underline"
                >
                  What each house costs
                </Link>
              ) : null}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
