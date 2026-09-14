import "server-only";

import { type ApiRequestInit, requestJson } from "./http";

// Recording a sign-in — the one event the product cannot reconstruct after the fact.
//
// An admin who signs in with WorkOS and then abandons /setup never calls an authenticated endpoint,
// so Rails never hears about them at all: the first step of the conversion funnel is invisible, and
// no later query can recover it. The AuthKit callback is the only place that knows, so it tells
// Rails at the time (https://linear.app/bloombase/issue/BLO-1671).
//
// `server-only`: this handles the access token, which must never reach a browser bundle.

/**
 * How long the callback is willing to wait for Rails before giving up and redirecting anyway.
 *
 * AuthKit awaits its `onSuccess` hook before it issues the redirect, so this is the worst case a
 * sign-in can be delayed by instrumentation. Rails sits beside the web app and answers this in
 * single-digit milliseconds; the budget exists for the case where it does not answer at all.
 */
const TIMEOUT_MS = 2_000;

/**
 * The half of the WorkOS user object that belongs in a `users` row.
 *
 * Structural on purpose rather than the SDK's `User`: this needs three fields, and typing it as the
 * whole WorkOS user would make every caller — and every test — construct one.
 */
export interface SignInIdentity {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * POST /api/sign_ins, best-effort.
 *
 * Never throws and never rejects: telemetry must not be able to break signing in. Every failure —
 * Rails down, the token already expired, API_URL unset, the timeout above — is logged and swallowed,
 * and the admin lands on their dashboard exactly as they would have.
 *
 * Safe to call more than once with the same token: Rails deduplicates by the token's `jti`, so a
 * retried callback records one sign-in rather than two.
 *
 * `identity` is who WorkOS says this is (https://linear.app/bloombase/issue/BLO-1696). An AuthKit
 * ACCESS TOKEN carries neither an email nor a name unless the WorkOS JWT template has been
 * configured to add them, so Rails — which only ever sees the token — provisioned the only real
 * admin in production with a placeholder address at an `.invalid` domain and no name at all, and the
 * operator console had nothing to show but "No name yet / Not provided". The callback is not
 * missing them: AuthKit hands it the whole authenticated WorkOS user. So it forwards them here, and
 * Rails fills the gaps in its own row. Snake case because that is the shape of the row.
 */
export async function recordSignIn(
  accessToken: string,
  identity: SignInIdentity = {},
): Promise<void> {
  const init: ApiRequestInit = {
    method: "POST",
    body: {
      email: identity.email ?? null,
      first_name: identity.firstName ?? null,
      last_name: identity.lastName ?? null,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };

  try {
    await requestJson<void>("/api/sign_ins", accessToken, init);
  } catch (error) {
    console.warn("Could not record a sign-in; continuing to the dashboard.", error);
  }
}
