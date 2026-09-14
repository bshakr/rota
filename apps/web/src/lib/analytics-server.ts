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

function requestInit(event: AnalyticsEvent, properties: AnalyticsProperties, token: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Analytics-Secret": token },
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
): Promise<boolean> {
  const token = secret();
  if (!token) return false;

  try {
    const response = await fetch(`${apiBaseUrl()}${EVENTS_PATH}`, requestInit(event, properties, token));
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
