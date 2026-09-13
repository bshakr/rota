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
 * POST /api/sign_ins, best-effort.
 *
 * Never throws and never rejects: telemetry must not be able to break signing in. Every failure —
 * Rails down, the token already expired, API_URL unset, the timeout above — is logged and swallowed,
 * and the admin lands on their dashboard exactly as they would have.
 *
 * Safe to call more than once with the same token: Rails deduplicates by the token's `jti`, so a
 * retried callback records one sign-in rather than two.
 */
export async function recordSignIn(accessToken: string): Promise<void> {
  const init: ApiRequestInit = { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) };

  try {
    await requestJson<void>("/api/sign_ins", accessToken, init);
  } catch (error) {
    console.warn("Could not record a sign-in; continuing to the dashboard.", error);
  }
}
