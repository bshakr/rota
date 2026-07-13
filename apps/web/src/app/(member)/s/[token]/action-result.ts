import type { ApiErrorBody } from "@/lib/api/errors";
import type { MemberShift } from "@/lib/api/types";

/**
 * What a cover mutation returns to the client. The member API client is
 * `server-only` and every call carries the magic-link token, so the interactive
 * list reaches it through a Server Action; this is the wire shape across that
 * boundary.
 *
 * A rejection comes back as `{ ok: false, error }` — the plain, serializable
 * `ApiErrorBody` (see `ApiError#toBody`) — rather than thrown, so the client can
 * show the API's own human `message` for each 422 code (past_shift, self_cover, …)
 * instead of a stack trace. On success the updated shift comes back, already
 * resolved for this member (its `can_assign_cover` / `can_cancel_cover` reflect the
 * new state), so the card re-renders from one authoritative value.
 *
 * This type lives apart from the `"use server"` module because that module may
 * only export async functions.
 */
export type CoverActionResult =
  | { ok: true; shift: MemberShift }
  | { ok: false; error: ApiErrorBody };
