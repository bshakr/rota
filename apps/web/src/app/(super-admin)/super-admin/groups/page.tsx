import type { Metadata } from "next";

import { isApiError } from "@/lib/api/errors";
import { type GroupRow, getGroups } from "@/lib/api/super-admin-groups";
import { isGroupsShapeError } from "@/lib/api/super-admin-groups";
import { groupsQuery, parseGroupsFilters } from "@/lib/hq-groups";

import { GroupsScreen } from "./_components/groups-screen";
import { GroupsUnavailable } from "./_components/groups-unavailable";

export const metadata: Metadata = { title: "Houses · HQ" };

// Live, per-request, behind an allowlist — never statically prerendered, and
// never cached: this list is read straight after doing something to a house, and
// a stale copy reads as "the action did nothing".
export const dynamic = "force-dynamic";

/**
 * Every house on Rota Monster.
 *
 * The same two jobs the overview page has, and nothing else: make the one API
 * call, and decide what a failure looks like. `GroupsScreen` owns the layout and
 * is given rows, which is what lets it be rendered from a fixture.
 *
 * THE FILTERS ARE THE URL. They are read out of `searchParams` here, validated
 * against what the API will actually accept, and forwarded — so a filtered view
 * is shareable and bookmarkable, back and forward move between filters, and the
 * operator's access token never has to cross into a client component to fetch.
 * The narrowing itself is Rails': the status filter has to be literally the same
 * code as the status pill, or the list disagrees with itself about which houses
 * are quiet.
 *
 * The failure policy is the overview's, for the same reason. Every figure on a
 * row is derived, so a missing one does not look missing — it looks like a fact,
 * and "0 failures" is a sentence an operator acts on.
 */
export default async function SuperAdminGroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // One clock for the whole render, passed down rather than read again in each
  // row: every "3 h ago" on this page is measured against the same instant, and a
  // `Date.now()` inside a component is a hydration mismatch waiting to happen.
  const now = new Date();
  const filters = parseGroupsFilters(await searchParams);

  // The fetch and the render are deliberately not nested: JSX built inside a
  // try/catch would put the screen's own render errors in the path of this
  // handler, which is an error boundary's job and not a page's.
  let groups: GroupRow[] | null = null;
  let failure: unknown = null;

  try {
    groups = await getGroups(groupsQuery(filters));
  } catch (error) {
    // A redirect or a notFound() thrown by the client (an expired session, a
    // caller who is not allowlisted) is rethrown untouched: swallowing one
    // strands the operator on a half-rendered page.
    if (!isApiError(error) && !isGroupsShapeError(error)) throw error;
    // Loud in development — the Next overlay names the failing field the moment
    // a shape drifts — and an error state in production, where an operator needs
    // a sentence rather than a stack trace.
    if (isGroupsShapeError(error) && process.env.NODE_ENV !== "production") throw error;
    if (isGroupsShapeError(error)) {
      // Only three people can reach this page, so a drift could sit on screen for
      // days before one of them looks. The log is what puts it in front of
      // whoever is watching the deploy that caused it; nobody greps a screenshot.
      console.error(
        "[super-admin/groups] payload did not match the expected shape:",
        error.issues.join("; "),
      );
    }

    failure = error;
  }

  if (groups === null) return <GroupsUnavailable error={failure} />;

  return <GroupsScreen groups={groups} filters={filters} now={now} />;
}
