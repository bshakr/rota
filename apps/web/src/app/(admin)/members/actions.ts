"use server";

import { revalidatePath } from "next/cache";

import {
  createMember,
  removeMember,
  rotateMemberLink,
  updateMember,
} from "@/lib/api/admin";
import { type ApiErrorBody, isApiError } from "@/lib/api/errors";
import type { MemberCreateParams, MemberUpdateParams } from "@/lib/api/types";

// The client half of this screen can't call the admin API directly — that client
// is `server-only` and forwards the admin's access token, which must never reach
// the browser. These Server Actions are the bridge: they run the mutation on the
// server, revalidate the members list so the table reflects the change, and hand
// back a plain, serializable result.
//
// A failed call comes back as `{ ok: false, error }` rather than a thrown error,
// so the caller can put a `validation_failed` field message back beside its input
// (a bad phone number belongs ON the phone field, not in a toast). Anything that
// is NOT an ApiError — most importantly the redirect a 401 raises inside the
// client — is re-thrown untouched, so re-auth still happens.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

const MEMBERS_PATH = "/members";

async function run<T>(mutate: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await mutate();
    revalidatePath(MEMBERS_PATH);
    return { ok: true, data };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

export async function createMemberAction(params: MemberCreateParams) {
  return run(() => createMember(params));
}

export async function updateMemberAction(id: number, params: MemberUpdateParams) {
  return run(() => updateMember(id, params));
}

/** Deactivation — the response enumerates the reassigned turns and dropped covers to show the admin. */
export async function removeMemberAction(id: number) {
  return run(() => removeMember(id));
}

export async function rotateMemberLinkAction(id: number) {
  return run(() => rotateMemberLink(id));
}
