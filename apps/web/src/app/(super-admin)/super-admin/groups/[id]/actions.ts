"use server";

import { revalidatePath } from "next/cache";

import { type ApiErrorBody, isApiError } from "@/lib/api/errors";
import {
  type GroupRow,
  resumeGroup,
  suspendGroup,
  updateGroup,
} from "@/lib/api/super-admin-groups";
import { GROUPS_HREF } from "@/lib/hq-groups";

// The three writes on a house, as server actions.
//
// The operator API client is `server-only`, so the dialogs on the group page
// reach it through here. Each one resolves the operator's token through
// `requireSuperAdmin()` inside the client, which means the token never crosses
// into a Client Component and the allowlist is re-checked on every write — by
// Next before the request, and by Rails before it is honoured.
//
// All three answer the same `{ group }` shape (`SuperAdmin::GroupSerializer.solo`),
// so the page merges one row rather than learning a shape per action. They are
// returned rather than thrown for the same reason the house's own actions do it:
// an `ApiError` is not serialisable across the RSC boundary, but its body is, and
// a dialog needs the message beside the field it names.

export type GroupActionResult = { ok: true; group: GroupRow } | { ok: false; error: ApiErrorBody };

/**
 * Everything on this page is server-rendered off `getGroup`, and the list beside
 * it counts the same facts, so both are revalidated after every write.
 *
 * Not an optimisation — a correctness rule. Suspending a house changes its pill,
 * its status filter membership and, from the next sweep, everything it sends; a
 * page that went on showing "Live" would be telling the operator their action did
 * nothing, which is the one thing they must never have to wonder about.
 */
function revalidate(id: number): void {
  revalidatePath(`${GROUPS_HREF}/${id}`);
  revalidatePath(GROUPS_HREF);
}

async function attempt(id: number, write: () => Promise<GroupRow>): Promise<GroupActionResult> {
  try {
    const group = await write();
    revalidate(id);
    return { ok: true, group };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

/**
 * Rename the house and set its timezone.
 *
 * Sending `timezone` at all CONFIRMS it: Rails stamps `timezone_confirmed_at`,
 * because the presence of the param is a human saying "I checked" and a super
 * admin setting it counts as a human confirming it. That is most of the point of
 * the action — the commonest reason to reach for it is a house being texted on a
 * UTC guess nobody ever corrected — and it is the same semantics the house's own
 * settings form carries, so the two cannot mean different things.
 */
export async function saveGroupSettings(
  id: number,
  params: { name: string; timezone: string },
): Promise<GroupActionResult> {
  return attempt(id, () => updateGroup(id, params));
}

/**
 * Write (or clear) the operator's private note about the house.
 *
 * A blank box clears it: Rails stores NULL rather than an empty string, so "has
 * this house got a note" stays one question and not two. Sent on its own so a
 * note can never carry a stale name or timezone along with it.
 */
export async function saveGroupNotes(id: number, notes: string): Promise<GroupActionResult> {
  return attempt(id, () => updateGroup(id, { notes }));
}

/** Pause the house. Idempotent, and a re-suspend never moves "paused since". */
export async function suspendHouse(id: number): Promise<GroupActionResult> {
  return attempt(id, () => suspendGroup(id));
}

/** Let it go again. Idempotent; clearing one column puts every refusal back. */
export async function resumeHouse(id: number): Promise<GroupActionResult> {
  return attempt(id, () => resumeGroup(id));
}
