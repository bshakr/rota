import "server-only";

import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/super-admin";

import { isApiError } from "./errors";
import { type ApiRequestInit, requestJson } from "./http";
import { type SuperAdminOverview, parseOverview } from "./super-admin-overview";

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
 * GET /api/super_admin/overview — the operator's landing data: the KPI ledger,
 * the attention list, the last ten houses with how far each got, and the health
 * of the recurring jobs.
 *
 * The one call in this app whose response is PARSED rather than cast. Every
 * figure on that page is derived, so a key Rails renames does not render as an
 * obvious blank — it renders as a zero that looks exactly like a real fact, and
 * an operator acts on it. `parseOverview` turns that into a named failure the
 * page can put on screen; see ./super-admin-overview.ts for the shape and the
 * reasoning.
 */
export async function getOverview(): Promise<SuperAdminOverview> {
  return parseOverview(await superAdminRequest<unknown>("/api/super_admin/overview"));
}
