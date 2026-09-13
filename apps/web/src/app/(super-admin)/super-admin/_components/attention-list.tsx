import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttentionRow } from "@/lib/api/super-admin-overview";
import { ATTENTION_PILL, attentionSentence, showingOf } from "@/lib/hq-overview";

/**
 * The houses that need a human, worst first — a queue of work rather than a
 * report.
 *
 * Rendered in the API's order and never re-sorted here. That order is the cost of
 * ignoring each row (failing texts first, because they are the only reason that
 * always costs a real person their reminder), a house appears ONCE under the
 * first reason it hits, and ties break by id so the list does not reshuffle under
 * the reader between two loads of the same data.
 *
 * Every row links to that house's own dashboard. That page arrives with
 * https://linear.app/bloombase/issue/BLO-1676 — the link is here now anyway,
 * because a row that tells you something is wrong and gives you nowhere to go is
 * half a feature, and the href does not change when the page lands.
 *
 * The cap is spoken aloud. The API sends at most fifty rows with the true total
 * beside them, and a page that renders fifty and says nothing implies fifty is
 * all there is — which is exactly how a bad week across three hundred houses
 * becomes invisible.
 */
export function AttentionList({ rows, total }: { rows: AttentionRow[]; total: number }) {
  const capped = showingOf(rows.length, total);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs a look</CardTitle>
        <CardDescription>
          {rows.length === 0
            ? "Nothing is stuck, failing or waiting on anyone."
            : "Worst first. Each house appears once, under the thing that costs most to ignore."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground rounded-xl bg-muted/60 px-4 py-6 text-center text-sm">
            Every house is behaving itself right now.
          </p>
        ) : (
          <>
            <ul className="divide-border -mx-2 divide-y">
              {rows.map((row) => {
                const pill = ATTENTION_PILL[row.reason];

                return (
                  <li key={`${row.group_id}-${row.reason}`}>
                    <Link
                      href={`/super-admin/groups/${row.group_id}`}
                      className="hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-xl px-2 py-3 transition-colors outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-heading text-sm font-semibold break-words">
                            {row.name}
                          </span>
                          <Badge variant={pill.tone}>{pill.label}</Badge>
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                          {attentionSentence(row.reason, row.count)}
                        </span>
                      </span>
                      <ChevronRight
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>

            {capped ? (
              <p className="text-muted-foreground mt-4 text-xs">
                {capped}. The rest are waiting behind these.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
