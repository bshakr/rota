import { CloudOff } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { isApiError } from "@/lib/api/errors";
import { type TrafficRange, isTrafficShapeError } from "@/lib/api/super-admin-traffic";

import { RangePicker } from "./range-picker";

/**
 * What the traffic page shows when it has no numbers to show.
 *
 * The same two failures the overview tells apart, for the same reason: an
 * `ApiError` means Rails refused or fell over (wait, then read the logs), and a
 * `TrafficShapeError` means Rails answered fine and this page does not recognise
 * the answer — a rename that landed on one side of a deploy only. They need
 * different follow-up, so they get different words. The zod issues are printed
 * because the only people who can reach this page are the people who would go
 * and fix it.
 *
 * A wrong-shaped payload is a DEV-TIME bug, so in development the page rethrows
 * and the Next overlay names the field. This is the production half: a sentence
 * an operator can act on, never a dashboard of plausible zeroes.
 *
 * The range picker stays, because one of the two failures is range-shaped — a
 * 90-day window that times out when 7 days would answer — and an operator with
 * no control at all can only reload.
 */
export function TrafficUnavailable({ error, range }: { error: unknown; range: TrafficRange }) {
  const shape = isTrafficShapeError(error) ? error : null;

  return (
    <>
      <PageHeader
        title="Traffic"
        description="Conversion and usage across every house."
        actions={<RangePicker range={range} />}
      />
      <EmptyState
        icon={CloudOff}
        title={shape ? "These numbers don't look right" : "Can't reach the numbers"}
        description={
          shape
            ? "The API answered, but not in the shape this page reads. Nothing is shown rather than something wrong. It usually means one side of a deploy is ahead of the other."
            : "The API didn't answer. Nothing here is lost — try again in a moment, or ask for a shorter range."
        }
      />
      {shape ? (
        <ul className="text-muted-foreground mt-4 space-y-1 font-mono text-xs">
          {shape.issues.map((issue) => (
            <li key={issue} className="break-words">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
      {isApiError(error) ? (
        <p className="text-muted-foreground mt-4 font-mono text-xs">{error.code}</p>
      ) : null}
    </>
  );
}
