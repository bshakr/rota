import { CloudOff } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { isApiError } from "@/lib/api/errors";
import { isGroupsShapeError } from "@/lib/api/super-admin-groups";

/**
 * What a house screen shows when it has no house to show.
 *
 * The twin of `OverviewUnavailable`, and it tells the same two failures apart for
 * the same reason: an `ApiError` means Rails refused or fell over (wait, then
 * look at the logs), a `GroupsShapeError` means Rails answered fine and this page
 * does not recognise the answer — a rename that landed on one side of a deploy
 * only. The zod issues are printed because the only people who can reach this
 * page are the three who would go and fix it.
 *
 * Shared by the list and by one group's page, with `title` naming which, so that
 * "which screen did this?" is answered on screen rather than by the URL.
 */
export function GroupsUnavailable({ error, title = "Houses" }: { error: unknown; title?: string }) {
  // Narrowed to a variable, not a boolean: `error` is `unknown` and the JSX below
  // needs the issues off it.
  const shape = isGroupsShapeError(error) ? error : null;

  return (
    <>
      <PageHeader
        title={title}
        description="Every house on Rota Monster, with what it has sent this week and whether anyone is still there."
      />
      <EmptyState
        icon={CloudOff}
        title={shape ? "This doesn't look right" : "Can't reach the houses"}
        description={
          shape
            ? "The API answered, but not in the shape this page reads. Nothing is shown rather than something wrong. It usually means one side of a deploy is ahead of the other."
            : "The API didn't answer. Nothing here is lost. Try again in a moment."
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
