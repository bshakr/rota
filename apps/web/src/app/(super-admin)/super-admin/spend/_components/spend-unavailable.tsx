import { CloudOff } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { isApiError } from "@/lib/api/errors";
import { isSpendShapeError } from "@/lib/api/super-admin-spend";
import type { SpendRange } from "@/lib/spend-constants";

import { RangePicker } from "./range-picker";

/**
 * What the spend page shows when it has no numbers to show.
 *
 * Two different failures, told apart on purpose, because they need different
 * follow-up. An `ApiError` means Rails refused or fell over — wait, then look at
 * the logs. A `SpendShapeError` means Rails answered fine and this page does not
 * recognise the answer: a rename that landed on one side only. The zod issues are
 * printed because the only people who can reach this page are the three people
 * who would go and fix it.
 *
 * The range picker stays on screen. One window failing does not mean the other
 * two will, and an operator whose 12-month query timed out should be one click
 * from thirty days rather than one back-button and a re-type.
 */
export function SpendUnavailable({ error, range }: { error: unknown; range: SpendRange }) {
  // Narrowed to a variable, not a boolean: `error` is `unknown` and the JSX below
  // needs the issues off it.
  const shape = isSpendShapeError(error) ? error : null;

  return (
    <>
      <PageHeader
        title="Spend"
        description="What every house costs to run, in texts and Claude calls, so the product can be priced against a real number."
        actions={<RangePicker range={range} />}
      />
      <EmptyState
        icon={CloudOff}
        title={shape ? "These figures don't look right" : "Can't reach the figures"}
        description={
          shape
            ? "The API answered, but not in the shape this page reads. Nothing is shown rather than something wrong — a cost that is half-right is worse than no cost at all. It usually means one side of a deploy is ahead of the other."
            : "The API didn't answer. Nothing here is lost — try again in a moment, or try a shorter window."
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
