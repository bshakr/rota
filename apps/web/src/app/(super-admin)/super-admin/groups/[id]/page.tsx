import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { getSpend } from "@/lib/api/super-admin";
import {
  type GroupDetail,
  type RedactedSms,
  getGroup,
  getGroupSmsMessages,
  isGroupsShapeError,
} from "@/lib/api/super-admin-groups";
import { isSpendShapeError } from "@/lib/api/super-admin-spend";
import { parseSmsLogFilters } from "@/lib/hq-group-report";
import { GROUP_SPEND_RANGE, type HouseSpendWindow, houseSpend } from "@/lib/hq-spend";

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
 * Makes the two API calls and decides what a failure looks like; `GroupScreen`
 * owns the layout and is given payloads, which is what lets it be rendered from a
 * fixture.
 *
 * THREE calls, started together, and they are not equals.
 *
 * The group payload carries the house, its rotas and the whole report in one
 * request — Rails puts them together precisely so the page cannot render half a
 * house while the other half is still in flight. The delivery log is its own
 * because it is the one part of this screen the operator NARROWS: its filters
 * live in the query string, so it has to be re-fetched when they change and the
 * rest does not. A failure in either is a failure of the screen; they are the
 * same Rails app behind the same token, so if the log is refusing the report is
 * not to be trusted either, and half a console is worse than a named error.
 *
 * The SPEND WINDOW is the third, and it fails SOFTLY — the same asymmetry the
 * overview page makes for the same tile. There is no per-group spend endpoint:
 * `SuperAdmin::Spend` answers for every house at once (cached a minute in Rails)
 * and `houseSpend` narrows it to this one, which is what stops the card and the
 * spend page ever disagreeing about what a house cost. A cost that could not be
 * counted must never render as a zero, and must not take the warnings down with
 * it either.
 *
 * A 404 becomes `notFound()`. Rails answers 404 both for "no such house" and for
 * "you are not an operator", and this deliberately does not try to tell them
 * apart: the right response to either is a page that says nothing.
 */
export default async function SuperAdminGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // One clock for the whole render, passed down rather than read again in each
  // card, so every elapsed time on the page is measured against one instant.
  const now = new Date();

  // The id is a path segment and therefore arbitrary. A non-numeric one is a 404
  // here rather than a request to Rails for `/groups/../../something`.
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // Validated here rather than forwarded: a stale bookmark carrying a status Rails
  // does not write would match nothing, and an empty log reads as "this house sent
  // no texts" — the worst wrong answer this page can give.
  const smsFilters = parseSmsLogFilters(await searchParams);

  // Settled into a value rather than left as a rejecting promise, because the two
  // failure paths below return early — and an unawaited rejection behind an early
  // return is an unhandled rejection in the server log.
  const spendOutcome = getSpend(GROUP_SPEND_RANGE).then(
    (payload) => ({ payload, error: null as unknown }),
    (error: unknown) => ({ payload: null, error }),
  );

  let detail: GroupDetail | null = null;
  let smsMessages: RedactedSms[] = [];
  let failure: unknown = null;

  try {
    [detail, smsMessages] = await Promise.all([
      getGroup(id),
      getGroupSmsMessages(id, smsFilters),
    ]);
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

  // A shape error is loud in development (the Next overlay names the drifting
  // field) and logged in production, exactly as the overview's is. A redirect or a
  // notFound() thrown by the client is rethrown untouched: an expired session is
  // not a missing card, it is a page that must not render.
  const { payload: spendPayload, error: spendError } = await spendOutcome;
  let spend: HouseSpendWindow | null = null;

  if (spendPayload !== null) {
    spend = houseSpend(spendPayload, id);
  } else {
    if (isSpendShapeError(spendError) && process.env.NODE_ENV !== "production") throw spendError;
    if (!isApiError(spendError) && !isSpendShapeError(spendError)) throw spendError;

    console.error(`[super-admin/groups/${id}] spend could not be counted:`, spendError);
  }

  return (
    <GroupScreen
      detail={detail}
      now={now}
      smsMessages={smsMessages}
      smsFilters={smsFilters}
      spend={spend}
    />
  );
}
