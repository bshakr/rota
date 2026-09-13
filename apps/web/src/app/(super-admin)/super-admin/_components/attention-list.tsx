import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttentionRow } from "@/lib/api/super-admin-overview";
import { ATTENTION_PILL, attentionSentence, showingOf } from "@/lib/hq-overview";

import { HouseRow } from "./house-row";

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
 * Every row WILL link to that house's own dashboard; see `HouseRow`, which asks
 * the nav whether that page exists yet (it does not —
 * https://linear.app/bloombase/issue/BLO-1676) and renders the name as plain
 * text until it does.
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
                    <HouseRow groupId={row.group_id}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-heading text-sm font-semibold break-words">
                          {row.name}
                        </span>
                        <Badge variant={pill.tone}>{pill.label}</Badge>
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                        {attentionSentence(row.reason, row.count)}
                      </span>
                    </HouseRow>
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
