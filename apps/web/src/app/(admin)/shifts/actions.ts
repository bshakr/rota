"use server";

import { updateShift } from "@/lib/api/admin";
import { type ApiErrorBody, isApiError } from "@/lib/api/errors";
import type { Shift } from "@/lib/api/types";

// The admin override, as a server action. The admin API client is `server-only`
// (it forwards the WorkOS token and must never reach the browser), so the client
// board reaches it through here. An `ApiError` is returned as its plain body so it
// crosses the RSC boundary and the client can toast it; anything else — notably
// the sign-in redirect the client throws on a 401 — is left to propagate.

export type SetCoverResult =
  | { ok: true; shift: Shift }
  | { ok: false; error: ApiErrorBody };

/** Set (`memberId`) or clear (`null`) the cover on one future shift. */
export async function setShiftCover(
  shiftId: number,
  coveringMemberId: number | null,
): Promise<SetCoverResult> {
  try {
    const { shift } = await updateShift(shiftId, { covering_member_id: coveringMemberId });
    return { ok: true, shift };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}
