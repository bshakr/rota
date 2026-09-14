import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { type GroupDetail, getGroup, isGroupsShapeError } from "@/lib/api/super-admin-groups";

import { GroupsUnavailable } from "../_components/groups-unavailable";
import { GroupScreen } from "./_components/group-screen";

export const metadata: Metadata = { title: "House · HQ" };

// Live, per-request, never cached. This is the screen an operator lands on
// straight after doing something to the house — suspending it, fixing a
// timezone, chasing a failed text — and a minute of staleness there reads as "the
// action did nothing". `SuperAdmin::GroupReport` is uncached on the Rails side for
// exactly the same reason.
export const dynamic = "force-dynamic";

/**
 * One house.
 *
 * Makes the one API call and decides what a failure looks like; `GroupScreen`
 * owns the layout and is given a payload, which is what lets it be rendered from
 * a fixture.
 *
 * A 404 becomes `notFound()`. Rails answers 404 both for "no such house" and for
 * "you are not an operator", and this deliberately does not try to tell them
 * apart: the right response to either is a page that says nothing.
 */
export default async function SuperAdminGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // One clock for the whole render, passed down rather than read again in each
  // card, so every elapsed time on the page is measured against one instant.
  const now = new Date();

  // The id is a path segment and therefore arbitrary. A non-numeric one is a 404
  // here rather than a request to Rails for `/groups/../../something`.
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let detail: GroupDetail | null = null;
  let failure: unknown = null;

  try {
    detail = await getGroup(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    // A redirect or a notFound() thrown by the client is rethrown untouched.
    if (!isApiError(error) && !isGroupsShapeError(error)) throw error;
    if (isGroupsShapeError(error) && process.env.NODE_ENV !== "production") throw error;
    if (isGroupsShapeError(error)) {
      console.error(
        `[super-admin/groups/${id}] payload did not match the expected shape:`,
        error.issues.join("; "),
      );
    }

    failure = error;
  }

  if (detail === null) return <GroupsUnavailable error={failure} title="House" />;

  return <GroupScreen detail={detail} now={now} />;
}
