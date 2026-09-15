import "server-only";

import { apiBaseUrl } from "./api/http";
import type { AnalyticsEvent, AnalyticsProperties } from "./analytics";
import { sanitiseProperties } from "./analytics";

/**
 * The server-to-server hop into Rails.
 *
 * Two callers, both on this side of the wall:
 *
 *   - the `/api/analytics` route handler, forwarding an event a browser sent;
 *   - `/callback`, sending `signin_completed` directly — WorkOS hosts the sign-in form, so that
 *     handler is the only place that knows a sign-in finished, and there is no browser hop to make.
 *
 * Authenticated by ANALYTICS_SHARED_SECRET, which never reaches the browser. Without it this is a
 * no-op and Rails answers 404 to anyone who tries the endpoint, so an unconfigured deploy has no
 * open write path into the events table rather than an unauthenticated one. That is the state in
 * CI, in tests and in local development.
 *
 * One optional extra travels with a landing view: the daily visitor code, in `X-Analytics-Visitor`.
 * It rides in a header rather than in the properties on purpose — see `requestInit`.
 */
const EVENTS_PATH = "/internal/analytics/events";
const TIMEOUT_MS = 2_000;

function secret(): string | undefined {
  return process.env.ANALYTICS_SHARED_SECRET?.trim() || undefined;
}

/** Whether anything will be sent at all. Exported so the route handler can answer honestly. */
export function analyticsConfigured(): boolean {
  return secret() !== undefined;
}

function requestInit(
  event: AnalyticsEvent,
  properties: AnalyticsProperties,
  token: string,
  visitorDigest: string | undefined,
): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Analytics-Secret": token,
  };

  // A HEADER, never a property, and this is the only place it is ever written. The properties are
  // what Rails stores in a row; the visitor code is what Rails ANSWERS A QUESTION with and then
  // throws away, and the two must not be able to end up in the same place by accident. Putting it
  // in the body would mean one forgotten allowlist entry away from a per-visitor identifier sitting
  // in `analytics_events.properties` for a hundred and eighty days.
  if (visitorDigest) headers["X-Analytics-Visitor"] = visitorDigest;

  return {
    method: "POST",
    headers,
    body: JSON.stringify({ name: event, properties: sanitiseProperties(properties) }),
    // Telemetry about a request, never part of one. Next must not cache or dedupe it.
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
}

/**
 * Awaited. Used by the route handler, which wants to know whether Rails took the event so it can
 * answer the browser with something true. Never rejects.
 */
export async function forwardAnalyticsEvent(
  event: AnalyticsEvent,
  properties: AnalyticsProperties = {},
  visitorDigest?: string,
): Promise<boolean> {
  const token = secret();
  if (!token) return false;

  try {
    const response = await fetch(
      `${apiBaseUrl()}${EVENTS_PATH}`,
      requestInit(event, properties, token, visitorDigest),
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fire and forget. Used by `/callback`, whose `onSuccess` hook is awaited by AuthKit: awaiting this
 * would put Rails' latency in front of every successful login, and a missing point on a chart is not
 * worth a slower sign-in.
 */
export function captureServerEvent(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  void forwardAnalyticsEvent(event, properties);
}
