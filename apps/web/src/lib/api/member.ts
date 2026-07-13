import "server-only";

import { requestJson } from "./http";
import type { MemberCoverResponse, MemberShiftsResponse } from "./types";

// The member magic-link API client — the second, deliberately narrow way in.
//
// The token is the member's permanent, non-expiring credential. It arrives at the
// `/s/[token]` page, is read SERVER-SIDE (the page awaits `params`), and is passed
// to these functions as an argument. Every function forwards it as
// `Authorization: Bearer <token>` and NOWHERE else — never a path segment, never a
// query param. Rails' `filter_parameters` redacts headers and bodies but logs the
// path verbatim at info, so a token in the URL would be written to production logs
// on every request. That is the exact leak a scaffold security review caught; the
// tests in member.test.ts assert it cannot come back.
//
// `server-only` is the structural half of the same guarantee: `next build` refuses
// to compile if a Client Component ever imports this module, so the token-handling
// code can never reach the browser bundle. The token is read and used here, on the
// server, and only the resulting shifts (which contain no token) cross to the client.

/** This member's upcoming shifts across every rota, plus the people they can ask to cover. */
export function getMemberShifts(token: string): Promise<MemberShiftsResponse> {
  return requestJson<MemberShiftsResponse>("/api/member/shifts", token);
}

/** Hand this shift to another member. Only the numeric shift id is in the path — never the token. */
export function assignCover(
  token: string,
  shiftId: number,
  coveringMemberId: number,
): Promise<MemberCoverResponse> {
  return requestJson<MemberCoverResponse>(`/api/member/shifts/${shiftId}/cover`, token, {
    method: "POST",
    body: { covering_member_id: coveringMemberId },
  });
}

/** Take a shift back (the original assignee always can). */
export function cancelCover(token: string, shiftId: number): Promise<MemberCoverResponse> {
  return requestJson<MemberCoverResponse>(`/api/member/shifts/${shiftId}/cover`, token, {
    method: "DELETE",
  });
}
