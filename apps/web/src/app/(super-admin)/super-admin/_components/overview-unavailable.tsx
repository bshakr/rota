import { CloudOff } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { isApiError } from "@/lib/api/errors";
import { isOverviewShapeError } from "@/lib/api/super-admin-overview";

/**
 * What the overview shows when it has no numbers to show.
 *
 * Two different failures, told apart on purpose, because they need different
 * follow-up. An `ApiError` means Rails refused or fell over — wait, then look at
 * the logs. An `OverviewShapeError` means Rails answered fine and this page does
 * not recognise the answer: a rename that landed on one side only. The zod issues
 * are printed because the only people who can reach this page are the three
 * people who would go and fix it.
 *
 * A wrong-shaped payload is a DEV-TIME bug, so in development the page rethrows
 * instead of rendering this and the error overlay says so in full. This state is
 * the production half of the same decision: an operator should get a sentence
 * they can act on, not a stack trace and not a dashboard of plausible zeroes.
 */
export function OverviewUnavailable({ error }: { error: unknown }) {
  // Narrowed to a variable, not a boolean: `error` is `unknown` and the JSX below
  // needs the issues off it.
  const shape = isOverviewShapeError(error) ? error : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every house on Rota Monster: how they are doing, what they send, and what needs a human."
      />
      <EmptyState
        icon={CloudOff}
        title={shape ? "These numbers don't look right" : "Can't reach the numbers"}
        description={
          shape
            ? "The API answered, but not in the shape this page reads. Nothing is shown rather than something wrong. It usually means one side of a deploy is ahead of the other."
            : "The API didn't answer. Nothing here is lost — try again in a moment."
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
