/**
 * The ten events, and the one function the browser uses to send three of them.
 *
 * There is no third party here. No SDK, no script in the page, no analytics cookie, no device or
 * session id. An event is a name from this allowlist plus a few allowlisted properties, posted to
 * our own `/api/analytics`, which forwards it to Rails, which writes a row. The funnel is counted in
 * aggregate and can never be replayed as one person's journey. That is a deliberate limit, and it is
 * why the site needs no consent banner.
 *
 * Where each one fires:
 *
 *   landing_view              browser, on `/`                       (_components/landing-view.tsx)
 *   cta_click                 browser, hero/closing/header CTAs     (_components/sign-in-link.tsx)
 *   signin_started            browser, the same click when the href is the sign-in hand-off
 *   signin_completed          Next server, /callback                (src/lib/analytics-server.ts)
 *   house_named               Rails, PATCH /api/group               (Api::GroupController)
 *   first_rota_saved          Rails, POST /api/rotas                (Api::RotasController)
 *   first_member_added        Rails, POST /api/members              (Api::MembersController)
 *   first_text_delivered      Rails, Twilio delivery receipt        (Webhooks::TwilioStatusController)
 *   first_member_link_opened  Rails, a member token first resolving (MemberAuthenticatable)
 *   calendar_connected        Rails, PUT /api/group/calendar        (Api::GroupCalendarController)
 *
 * The split between the first four and the last six is a security boundary, not a category. A
 * browser can post to `/api/analytics`, so that route accepts ONLY the three the browser owns; a
 * visitor must never be able to forge "this house got a text delivered", which is the number the
 * whole funnel is for. The six house events are written in-process by Rails and have no HTTP path.
 *
 * This module is the single definition shared by the browser, the route handler and the tests.
 * `analytics.test.ts` reads the Ruby model and asserts the two allowlists have not drifted apart.
 */

/** Which call to action a visitor pressed. The homepage has exactly three. */
export const CTA_POSITIONS = ["hero", "closing", "header"] as const;
export type CtaPosition = (typeof CTA_POSITIONS)[number];

/** The three a browser is allowed to send. Anything else posted to `/api/analytics` is refused. */
export const BROWSER_EVENTS = ["landing_view", "cta_click", "signin_started"] as const;

/** Sent by a server: `/callback` for the first, Rails in-process for the rest. */
export const SERVER_EVENTS = [
  "signin_completed",
  "house_named",
  "first_rota_saved",
  "first_member_added",
  "first_text_delivered",
  "first_member_link_opened",
  "calendar_connected",
] as const;

export const ANALYTICS_EVENTS = [...BROWSER_EVENTS, ...SERVER_EVENTS] as const;

export type BrowserEvent = (typeof BROWSER_EVENTS)[number];
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Every property any event may carry. A campaign label, a CTA position, a path, and the member id
 * that makes "two housemates opened" countable. No names, no phone numbers, no tokens, no free text.
 * Mirrors `AnalyticsEvent::PROPERTY_KEYS` in Rails.
 */
export const PROPERTY_KEYS = [
  "position",
  "path",
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "member_id",
] as const;

export type PropertyKey = (typeof PROPERTY_KEYS)[number];
export type AnalyticsProperties = Partial<Record<PropertyKey, string | number | boolean>>;

/** Matches `AnalyticsEvent::MAX_VALUE_LENGTH`. A campaign name is a label, never a payload. */
export const MAX_PROPERTY_LENGTH = 200;

/**
 * Nothing this route accepts needs more than this. Bigger bodies are refused unread by the route
 * handler, which is what stands between the table and a stranger with curl.
 */
export const MAX_BODY_BYTES = 2048;

/** Our own route, on our own origin. No external host is ever contacted from the page. */
export const ANALYTICS_ENDPOINT = "/api/analytics";

export function isBrowserEvent(value: unknown): value is BrowserEvent {
  return typeof value === "string" && (BROWSER_EVENTS as readonly string[]).includes(value);
}

/**
 * Allowlist in, allowlist out. Anything not named here is discarded rather than rejected: losing one
 * property is better than losing the event that carried it. Rails sanitises again on arrival, and
 * the day the two disagree should be a dropped property, not a stored surprise.
 */
export function sanitiseProperties(raw: unknown): AnalyticsProperties {
  if (typeof raw !== "object" || raw === null) return {};

  const source = raw as Record<string, unknown>;
  const cleaned: AnalyticsProperties = {};
  for (const key of PROPERTY_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      const trimmed = value.trim().slice(0, MAX_PROPERTY_LENGTH);
      if (trimmed) cleaned[key] = trimmed;
    } else if (typeof value === "boolean" || (typeof value === "number" && Number.isInteger(value))) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/** A CTA press. `position` is required: an unattributed CTA click cannot be acted on. */
export function track(event: "cta_click", properties: { position: CtaPosition }): void;
/** Any other event the browser owns. */
export function track(event: Exclude<BrowserEvent, "cta_click">, properties?: AnalyticsProperties): void;
export function track(event: BrowserEvent, properties?: AnalyticsProperties): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;

  // Sanitising first is also what bounds the size: eight allowlisted keys, each capped at
  // MAX_PROPERTY_LENGTH, cannot add up to MAX_BODY_BYTES. analytics.test.ts asserts that, so there is
  // no length check here to go stale — if the allowlist ever grows past the limit, the test says so.
  const body = JSON.stringify({ name: event, properties: sanitiseProperties(properties ?? {}) });

  try {
    // sendBeacon first: the browser takes the request off our hands and delivers it even if the page
    // is being torn down, which is exactly the case for a CTA click — the click navigates away.
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ANALYTICS_ENDPOINT, blob)) return;
    }

    // Fallback for a browser without it, or a beacon the browser refused to queue. `keepalive` is
    // the same promise in fetch's clothing. Fire and forget either way: a measurement must never sit
    // between a visitor and the page they asked for.
    void fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Offline, blocked, or the route is down. There is nothing to retry and nobody to tell.
    });
  } catch {
    // Some browsers throw from sendBeacon rather than returning false. Same answer.
  }
}
