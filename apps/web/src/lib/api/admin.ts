import "server-only";

import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import { isApiError } from "./errors";
import { type ApiRequestInit, requestJson } from "./http";
import type {
  GroupResponse,
  GroupUpdateParams,
  Me,
  MemberCreateParams,
  MemberRemovalResponse,
  MemberResponse,
  MembersResponse,
  MemberUpdateParams,
  RotaPositionsResponse,
  RotaPreviewParams,
  RotaPreviewResponse,
  RotaResponse,
  RotasResponse,
  RotaWriteParams,
  ShiftResponse,
  ShiftsResponse,
  ShiftUpdateParams,
  SmsMessagesQuery,
  SmsMessagesResponse,
} from "./types";

// The admin API client — server-side, JWT-forwarding.
//
// AuthKit holds the encrypted session and hands us a short-lived, WorkOS-signed
// access token via `withAuth()`. We forward that token to Rails as a bearer
// header on every `/api/*` call; Rails verifies the signature and scopes the query
// to the group the token names. Token refresh is entirely AuthKit's job — we never
// touch the refresh token.
//
// `server-only`: the access token and the API origin must never reach the browser.

/**
 * The core request. Resolves the caller's access token (redirecting to sign-in if
 * there is no session at all), forwards it, and — the one piece of judgement here
 * — turns a Rails 401 into a clean re-auth rather than a crash: AuthKit gave us a
 * token but Rails refused it (rotated signing key, revoked session), so the honest
 * move is to send the admin back through sign-in for a fresh one.
 */
async function adminRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { accessToken } = await withAuth({ ensureSignedIn: true });

  try {
    return await requestJson<T>(path, accessToken, init);
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      redirect(await getSignInUrl());
    }
    throw error;
  }
}

function withQuery(path: string, query?: Record<string, string | number | undefined>): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

// --- Identity ---------------------------------------------------------------

/** GET /api/me — the signed-in admin, their group, and role. Exercises the whole auth path. */
export function getMe(): Promise<Me> {
  return adminRequest<Me>("/api/me");
}

// --- Group ------------------------------------------------------------------

export function getGroup(): Promise<GroupResponse> {
  return adminRequest<GroupResponse>("/api/group");
}

/** Sending `timezone` at all confirms it (Rails stamps `timezone_confirmed_at`). */
export function updateGroup(params: GroupUpdateParams): Promise<GroupResponse> {
  return adminRequest<GroupResponse>("/api/group", { method: "PATCH", body: params });
}

// --- Members ----------------------------------------------------------------

export function listMembers(): Promise<MembersResponse> {
  return adminRequest<MembersResponse>("/api/members");
}

export function createMember(params: MemberCreateParams): Promise<MemberResponse> {
  return adminRequest<MemberResponse>("/api/members", { method: "POST", body: params });
}

export function updateMember(id: number, params: MemberUpdateParams): Promise<MemberResponse> {
  return adminRequest<MemberResponse>(`/api/members/${id}`, { method: "PATCH", body: params });
}

/** Deactivate (never destroy) and get back exactly what moved: reassignments and dropped covers. */
export function removeMember(id: number): Promise<MemberRemovalResponse> {
  return adminRequest<MemberRemovalResponse>(`/api/members/${id}`, { method: "DELETE" });
}

/** Rotate the magic-link token — for a lost phone. The old link stops working immediately. */
export function rotateMemberLink(id: number): Promise<MemberResponse> {
  return adminRequest<MemberResponse>(`/api/members/${id}/rotate_link`, { method: "POST" });
}

// --- Rotas ------------------------------------------------------------------

export function listRotas(): Promise<RotasResponse> {
  return adminRequest<RotasResponse>("/api/rotas");
}

export function getRota(id: number): Promise<RotaResponse> {
  return adminRequest<RotaResponse>(`/api/rotas/${id}`);
}

export function createRota(params: RotaWriteParams): Promise<RotaResponse> {
  return adminRequest<RotaResponse>("/api/rotas", { method: "POST", body: params });
}

/**
 * A schedule change (starts_on / interval_*) without `confirm` answers with a
 * `confirmation_required` ApiError carrying the `warning` of what it would drop,
 * and changes nothing. Re-send with `{ confirm: true }` to go through with it.
 */
export function updateRota(
  id: number,
  params: RotaWriteParams,
  options?: { confirm?: boolean },
): Promise<RotaResponse> {
  const body = options?.confirm ? { ...params, confirm: true } : params;
  return adminRequest<RotaResponse>(`/api/rotas/${id}`, { method: "PATCH", body });
}

/** Retire a rota (deactivate). History stands; the reminder sweep stops visiting it. */
export function deleteRota(id: number): Promise<RotaResponse> {
  return adminRequest<RotaResponse>(`/api/rotas/${id}`, { method: "DELETE" });
}

/** Replace the roster in one call. The order IS the rotation; regeneration preserves covers. */
export function updateRotaPositions(
  rotaId: number,
  memberIds: number[],
): Promise<RotaPositionsResponse> {
  return adminRequest<RotaPositionsResponse>(`/api/rotas/${rotaId}/positions`, {
    method: "PUT",
    body: { member_ids: memberIds },
  });
}

/** Render the live message preview through the real sender, so it can't flatter a broken template. */
export function previewRotaMessage(
  rotaId: number,
  params?: RotaPreviewParams,
): Promise<RotaPreviewResponse> {
  return adminRequest<RotaPreviewResponse>(`/api/rotas/${rotaId}/preview_message`, {
    method: "POST",
    body: params ?? {},
  });
}

// --- Shifts -----------------------------------------------------------------

export function listShifts(rotaId: number): Promise<ShiftsResponse> {
  return adminRequest<ShiftsResponse>(`/api/rotas/${rotaId}/shifts`);
}

/** The admin override: set (`covering_member_id`) or clear (`null`) a shift's cover. */
export function updateShift(id: number, params: ShiftUpdateParams): Promise<ShiftResponse> {
  return adminRequest<ShiftResponse>(`/api/shifts/${id}`, { method: "PATCH", body: params });
}

// --- SMS delivery log -------------------------------------------------------

export function listSmsMessages(query?: SmsMessagesQuery): Promise<SmsMessagesResponse> {
  return adminRequest<SmsMessagesResponse>(
    withQuery("/api/sms_messages", {
      status: query?.status,
      kind: query?.kind,
      member_id: query?.member_id,
      rota_id: query?.rota_id,
      limit: query?.limit,
    }),
  );
}
