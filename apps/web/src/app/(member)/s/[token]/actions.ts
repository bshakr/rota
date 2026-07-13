"use server";

import { isApiError } from "@/lib/api/errors";
import { assignCover, cancelCover } from "@/lib/api/member";

import type { CoverActionResult } from "./action-result";

// The member page's two writes, as Server Actions — the bridge between the
// interactive (client) list and the `server-only` member API client.
//
// The magic-link `token` is the FIRST argument on purpose: the page reads it from
// the route params server-side and binds it (`assignCoverAction.bind(null, token)`)
// before handing the action to the client. The client therefore holds an opaque
// action reference, never the token — Next encrypts the bound argument and strips
// the action body from client bundles, so the credential stays on this side of the
// wire exactly as the shift-list needs it to. The client only ever supplies the
// non-secret ids (which shift, which member).
//
// An `ApiError` is returned as its plain body so the client can toast the API's own
// human message for each rejection code; anything else (a genuinely unreachable API
// host) is left to propagate to the error boundary.

/** Hand this shift to another member (rule 1: whoever is responsible may hand it on). */
export async function assignCoverAction(
  token: string,
  shiftId: number,
  coveringMemberId: number,
): Promise<CoverActionResult> {
  try {
    const { shift } = await assignCover(token, shiftId, coveringMemberId);
    return { ok: true, shift };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

/** Take this shift back (rule 2: the original assignee always can). */
export async function cancelCoverAction(
  token: string,
  shiftId: number,
): Promise<CoverActionResult> {
  try {
    const { shift } = await cancelCover(token, shiftId);
    return { ok: true, shift };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}
