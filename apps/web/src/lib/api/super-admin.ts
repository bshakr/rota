import "server-only";

import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/super-admin";

import { isApiError } from "./errors";
import { type ApiRequestInit, requestJson } from "./http";
import type { SuperAdminOverview } from "./types";

// The super admin API client — the operator's half of ./admin.ts, and separate
// from it on purpose.
//
// Same transport (`requestJson`, same bearer header, same typed errors), but a
// different gate: the token comes from `requireSuperAdmin()`, which calls
// `withAuth()` directly and needs no household. The admin client's
// `requireHousehold()` would send an operator with no house of their own to
// /setup, and Rails accepts an org-less token on `/api/super_admin/*` precisely
// so it does not have to.
//
// Two clients rather than a flag on one, for the same reason Rails has two base
// controllers: a single client with an "and also allow no organization" escape
// hatch is how the tenant seam quietly acquires a hole.
//
// `server-only`: the access token and the API origin never reach the browser.

/**
 * The core request. Resolves the operator's access token — 404ing anyone who is
 * not allowlisted before a single byte goes to Rails — forwards it, and turns a
 * Rails 401 into the re-auth prompt rather than a crash, exactly as the admin
 * client does.
 *
 * A 404 from Rails is NOT special-cased here. Rails answers 404 both for "you
 * are not a super admin" and for "no such group", and the caller is better
 * placed to tell those apart than a shared helper is.
 */
async function superAdminRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { accessToken } = await requireSuperAdmin();

  try {
    return await requestJson<T>(path, accessToken, init);
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      redirect("/auth/reauth");
    }
    throw error;
  }
}

// --- Overview ---------------------------------------------------------------

/**
 * GET /api/super_admin/overview — the operator's landing data.
 *
 * The endpoint exists (https://linear.app/bloombase/issue/BLO-1669) and answers
 * `{}` until the query object behind it lands
 * (https://linear.app/bloombase/issue/BLO-1677). It is the one call that proves
 * the whole path — allowlist, bearer header, Rails' own allowlist check — so it
 * ships with the client rather than waiting for the page that will render it
 * (https://linear.app/bloombase/issue/BLO-1678).
 */
export function getOverview(): Promise<SuperAdminOverview> {
  return superAdminRequest<SuperAdminOverview>("/api/super_admin/overview");
}
