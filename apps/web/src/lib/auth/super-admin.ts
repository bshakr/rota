import "server-only";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { notFound } from "next/navigation";
import { cache } from "react";

// Who the operator is, and how the web app knows.
//
// A super admin is a WorkOS user id listed in `SUPER_ADMIN_WORKOS_USER_IDS` in
// the one root .env — read here and, independently, by Rails. Granting god mode
// is therefore a DEPLOY, not a click: there is no column, no role and no API
// that can add someone.
//
// Rails owns the actual enforcement (`SuperAdmin::BaseController` verifies the
// JWT and re-checks this same list before answering anything). The check in this
// module is cosmetic: it hides the nav link and 404s the route group. A
// divergence between the two lists is a cosmetic bug, never an escalation.
//
// UNSET MEANS NOBODY, including in development — so a typo in the variable name
// closes the door rather than opening it, and a deploy that has not had the
// variable set yet is inert.
//
// `server-only`: the allowlist is operator configuration with no business in a
// browser bundle. bundle-safety.test.ts asserts no Client Component imports this
// module, and scripts/assert-token-not-in-bundle.mjs greps the built client
// chunks for the variable name to prove it never reaches one.

/**
 * Comma separated, trimmed, blanks dropped. Pure — the env read is the caller's,
 * so a test can exercise the parsing without touching `process.env`.
 *
 * Empty or unset is the empty list, which is nobody: `isSuperAdmin` then answers
 * false for every id, including a well-formed one.
 */
export function parseSuperAdminIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * The configured ids. Read at CALL time, never at module load: the value arrives
 * from the environment at runtime (Railway), and a module-level constant would
 * freeze whatever was set when the server bundle was first imported.
 */
export function superAdminIds(): string[] {
  return parseSuperAdminIds(process.env.SUPER_ADMIN_WORKOS_USER_IDS);
}

/** Is this WorkOS user id on the allowlist? Exact match; no prefix, no pattern. */
export function isSuperAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return superAdminIds().includes(userId);
}

/**
 * The guard for the `(super-admin)` route group, beside `requireHousehold()` and
 * deliberately unlike it: no organization is required, because an operator may
 * have no house of their own.
 *
 * A caller who is not allowlisted — and a request with no session at all, which
 * the proxy should already have bounced to WorkOS — gets `notFound()`. 404, not
 * 403: a surface you cannot use should look like one that does not exist, which
 * is the same rule the tenancy seam follows.
 *
 * `cache()` for the same reason `requireHousehold` has it: Next may render the
 * layout and the page concurrently, and both call this.
 */
export const requireSuperAdmin = cache(async () => {
  const auth = await withAuth();
  if (!auth.user || !isSuperAdmin(auth.user.id)) notFound();
  return auth;
});
