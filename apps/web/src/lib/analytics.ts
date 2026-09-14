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
 * The properties a BROWSER may set. A campaign label, a CTA position, a path, the member id that
 * makes "two housemates opened" countable, and the host that linked here. No names, no phone
 * numbers, no tokens, no free text.
 */
export const BROWSER_PROPERTY_KEYS = [
  "position",
  "path",
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "member_id",
  "referrer_host",
] as const;

/**
 * The properties only a SERVER may set, derived from request headers the page cannot forge.
 *
 * The same split, and for the same reason, as BROWSER_EVENTS against SERVER_EVENTS above: anybody
 * can post to `/api/analytics`, so a value a visitor could choose is a value that says nothing. A
 * country the browser supplied would be a country the browser made up, and the country breakdown on
 * the traffic page would be a chart of whatever a script felt like claiming. The route handler
 * sanitises an incoming body against the BROWSER list, which drops these on the floor, and then
 * merges in what it read off the headers itself.
 *
 * Five of them now, and the two added last are the ones that sound like tracking: a browser FAMILY
 * and an OS FAMILY. Neither is a version, and that is the whole difference. "Chrome" and "macOS"
 * each put a third of the internet in one bucket; "Chrome 141.0.7390.55 on macOS 15.6.1" is a
 * fingerprint, which is exactly why the version is thrown away here rather than stored and ignored.
 */
export const SERVER_PROPERTY_KEYS = ["country", "city", "device", "browser", "os"] as const;

/**
 * Every property any event may carry, and there will never be one that is not on this list.
 * Mirrors `AnalyticsEvent::PROPERTY_KEYS` in Rails, in the same order.
 */
export const PROPERTY_KEYS = [...BROWSER_PROPERTY_KEYS, ...SERVER_PROPERTY_KEYS] as const;

export type PropertyKey = (typeof PROPERTY_KEYS)[number];
export type AnalyticsProperties = Partial<Record<PropertyKey, string | number | boolean>>;

/**
 * How a visit was made, to three buckets and no further.
 *
 * Coarse on purpose. "Was this a phone" is a design question worth answering; anything finer is a
 * fingerprint, and a screen size, an OS version or a browser build would each narrow a visitor down
 * far better than they would inform a layout decision.
 */
export const DEVICE_CLASSES = ["mobile", "tablet", "desktop"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/**
 * Which browser, to six buckets, and never which version of it.
 *
 * The same rule as DEVICE_CLASSES above and it matters more here, because the browser is where a
 * fingerprint usually starts. A family is a fact about rendering that a layout decision can be made
 * on; a build number is a near-unique string that would narrow a visitor down to a handful of people
 * on the internet. The version is read past and dropped, never stored.
 *
 * `other` is the honest bucket rather than a dumping ground: every engine that is not one of the
 * five gets counted rather than silently missed, and a column of "Other" growing is itself the
 * signal that the list is short.
 */
export const BROWSER_FAMILIES = ["chrome", "safari", "firefox", "edge", "samsung", "other"] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

/**
 * Which operating system, to six buckets, and never which version of it.
 *
 * "macOS" is a hundred million machines and "macOS 15.6.1 on Intel" is a much smaller room. Only the
 * family is kept, for the reason above.
 */
export const OS_FAMILIES = ["ios", "android", "macos", "windows", "linux", "other"] as const;
export type OsFamily = (typeof OS_FAMILIES)[number];

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
 *
 * `keys` is what makes the browser/server split real rather than documentary: pass
 * BROWSER_PROPERTY_KEYS and a `country` in the body simply is not there afterwards. The default is
 * every key, because the other caller is the server-to-server hop, which is forwarding values it
 * derived itself.
 */
export function sanitiseProperties(
  raw: unknown,
  keys: readonly PropertyKey[] = PROPERTY_KEYS,
): AnalyticsProperties {
  if (typeof raw !== "object" || raw === null) return {};

  const source = raw as Record<string, unknown>;
  const cleaned: AnalyticsProperties = {};
  for (const key of keys) {
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

/** What a stranger posting to `/api/analytics` is allowed to have said about themselves. */
export function sanitiseBrowserProperties(raw: unknown): AnalyticsProperties {
  return sanitiseProperties(raw, BROWSER_PROPERTY_KEYS);
}

/**
 * A hostname, and nothing that is merely shaped like one.
 *
 * Labels of letters, digits and hyphens, each starting and ending in an alphanumeric, joined by
 * dots, with the optional port `URL.host` leaves on. Mirrors the same check in Rails, which runs it
 * again on arrival: this side knows what a request may contain and the model knows what a row may
 * contain, and the day those disagree should be a dropped property rather than a stored surprise.
 */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export function isHostname(value: string): boolean {
  return value.length <= MAX_PROPERTY_LENGTH && HOSTNAME.test(value);
}

/**
 * Which site linked here: the HOST of `document.referrer`, lowercased, and nothing else from it.
 *
 * The path and the query are dropped before anything leaves the page, and dropped here rather than
 * on arrival, because a referring URL is exactly the kind of thing that carries somebody's search
 * terms, their session token or their email address in a query parameter. A host cannot.
 *
 * Undefined for a visit with no referrer at all, and for one that came from our own pages: a
 * housemate clicking through the site is not a source of traffic, and counting them would put Rota
 * Monster at the top of its own referrer table.
 */
export function referrerHost(referrer: string, origin: string): string | undefined {
  if (!referrer) return undefined;

  let host: string;
  try {
    host = new URL(referrer).host.toLowerCase();
  } catch {
    // A referrer that is not a URL. Nothing to report and nobody to tell.
    return undefined;
  }

  if (!host || !isHostname(host)) return undefined;

  try {
    if (host === new URL(origin).host.toLowerCase()) return undefined;
  } catch {
    // No usable origin to compare against. Better a referrer we might have dropped than none.
  }

  return host;
}

/**
 * A city name and nothing that is merely shaped like one.
 *
 * A letter, then letters, combining marks, spaces, hyphens, apostrophes and full stops. Wide enough
 * for "Saint-Étienne", "St. Albans", "N'Djamena" and "Ciudad Juárez"; narrow enough that the column
 * on the traffic page cannot grow a row that is really a sentence somebody chose. No digits: no city
 * Cloudflare names has one, and allowing them would admit the id-shaped junk this check exists for.
 */
const CITY = /^\p{L}[\p{L}\p{M} .'’-]*$/u;

/**
 * What a server can tell about a visit from the request it already received, and nothing more.
 *
 * Five coarse, allowlisted values, every one of them read off headers a browser cannot choose:
 *
 *   country  Cloudflare's `cf-ipcountry`, two letters. Sent for every visit now that the domain is
 *            proxied there. "XX" and "T1" are Cloudflare's own words for unknown and Tor; neither is
 *            a country and both are dropped.
 *   city     Cloudflare's `cf-ipcity`, the name and nothing else. Only arrives once the zone's
 *            "Add visitor location headers" transform is on, and is simply omitted until it is —
 *            never guessed at, and never looked up from the IP by us.
 *   device   phone, tablet or computer, from the `sec-ch-ua-mobile` client hint, falling back to the
 *            user agent for the browsers that do not send hints.
 *   browser  one of six families, from the `sec-ch-ua` brand list, falling back to the agent.
 *   os       one of six families, from `sec-ch-ua-platform`, falling back to the agent.
 *
 * THE IP IS NEVER READ HERE, AND THE USER AGENT IS NEVER KEPT. The agent string is matched against a
 * handful of patterns and goes out of scope on the next line; what is stored is one word from a
 * closed set each time. That is the whole difference between a device class and a fingerprint, and
 * it is why no version number survives this function.
 *
 * The OTHER location headers Cloudflare can send are deliberately never read: not
 * `cf-iplatitude`, not `cf-iplongitude`, not `cf-postal-code`, not `cf-region`, not
 * `cf-metro-code`, not `cf-timezone`. A postcode is a street and a coordinate pair is a map pin;
 * both are the thing the privacy page promises is not recorded, and the way to keep that promise is
 * not to read them in the first place.
 */
export function visitContext(headers: Headers): AnalyticsProperties {
  const context: AnalyticsProperties = {};

  const country = headers.get("cf-ipcountry")?.trim().toUpperCase();
  // "XX" is Cloudflare for "we could not tell" and "T1" for "this came out of Tor". Storing either
  // would put a bar labelled with a non-country on the traffic page.
  if (country && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1") {
    context.country = country;
  }

  // Only alongside a country, never on its own. A city with no country did not come from a working
  // location lookup: it is either a header somebody in front of us set by hand or Cloudflare noise,
  // and a lone city name is also the one shape of this value that would be hard to read as coarse.
  // With the country beside it, "Manchester, GB" is a bucket of half a million people.
  if (context.country) {
    const city = headers.get("cf-ipcity")?.trim().slice(0, MAX_PROPERTY_LENGTH);
    if (city && CITY.test(city)) context.city = city;
  }

  const device = deviceClass(headers);
  if (device) context.device = device;

  const browser = browserFamily(headers);
  if (browser) context.browser = browser;

  const os = osFamily(headers);
  if (os) context.os = os;

  return context;
}

// A phone says so in the hint when it sends one. Chrome on an Android tablet sends "?0", so the
// hint is trusted first and only falls through to the agent string for Safari and Firefox, which
// send no hints at all.
//
// Tablets are asked about before phones, because an Android tablet's agent contains "Android"
// without "Mobile" and asking the other way round would read every tablet as a phone. An iPad in
// its default desktop mode is a computer by every signal it sends, and is counted as one: guessing
// past what the request says is how a device breakdown stops being evidence.
const TABLET_AGENT = /ipad|tablet|kindle|playbook|silk|(android(?!.*mobile))/i;
const MOBILE_AGENT = /mobi|iphone|ipod|blackberry|iemobile|opera mini|windows phone/i;

function deviceClass(headers: Headers): DeviceClass | undefined {
  const hint = headers.get("sec-ch-ua-mobile")?.trim();
  if (hint === "?1") return "mobile";

  const agent = headers.get("user-agent") ?? "";
  if (TABLET_AGENT.test(agent)) return "tablet";
  if (MOBILE_AGENT.test(agent)) return "mobile";

  // Nothing to go on at all: no hint and no agent. Omitted rather than filed under desktop, which
  // would quietly make every scripted request a computer.
  if (hint !== "?0" && !agent) return undefined;

  return "desktop";
}

/**
 * Which browser, from the brand list first and the agent string second.
 *
 * `sec-ch-ua` is the modern answer and every Chromium browser sends it: a list like
 * `"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"`. The specific brands are asked
 * about BEFORE the generic ones, because Edge and Samsung Internet both announce "Chromium" too and
 * asking the other way round would file every one of them under Chrome.
 *
 * Brave, Opera and Vivaldi are counted as Chrome, and that is a known limit rather than an oversight.
 * They announce "Chromium" and their own brand, and adding a bucket per Chromium skin would be a
 * longer list that still missed the next one. What the column is for is "which engine renders our
 * pages", and for those three the answer really is Chromium.
 *
 * Safari and Firefox send no brand list at all, which is what the agent fallback is for. Nothing is
 * returned when there is neither a brand list nor an agent, for the same reason the device class
 * omits itself: a scripted request with no headers must not quietly become a Chrome user.
 */
function browserFamily(headers: Headers): BrowserFamily | undefined {
  const brands = headers.get("sec-ch-ua") ?? "";
  if (brands) {
    if (/samsung internet/i.test(brands)) return "samsung";
    if (/microsoft edge/i.test(brands)) return "edge";
    if (/google chrome|chromium/i.test(brands)) return "chrome";

    // A brand list that named nothing we know. It is still a real browser and gets counted as one.
    return "other";
  }

  const agent = headers.get("user-agent") ?? "";
  if (!agent) return undefined;

  // iOS order matters: every browser on iOS is Safari underneath and says "Safari" in its agent, so
  // the ones that also say who they really are have to be asked about first.
  if (/fxios|firefox/i.test(agent)) return "firefox";
  if (/edgios|edga|edg\//i.test(agent)) return "edge";
  if (/samsungbrowser/i.test(agent)) return "samsung";
  if (/crios|chrome|chromium/i.test(agent)) return "chrome";
  if (/safari/i.test(agent)) return "safari";

  return "other";
}

/**
 * Which operating system, from the platform hint first and the agent string second.
 *
 * `sec-ch-ua-platform` arrives quoted — `"macOS"` — and is the value to trust when it is there,
 * because it is the browser answering the question directly rather than us inferring it from a
 * string written to be lied about. Chrome OS is a platform the hint names and this list does not, so
 * it lands in `other`; a seventh bucket for it can be added the day one appears.
 *
 * THE IPAD LIMIT, stated rather than worked around: an iPad in its default desktop mode reports
 * itself as a Macintosh in both the hint and the agent, and the only signals that would separate the
 * two — `navigator.maxTouchPoints`, a touch media query — exist in the page and not in the request.
 * So some iPads are counted as macOS here, exactly as some are counted as a computer by the device
 * class above, and for the same reason: guessing past what the request actually says is how a
 * breakdown stops being evidence.
 */
function osFamily(headers: Headers): OsFamily | undefined {
  const platform = headers.get("sec-ch-ua-platform")?.trim().replace(/^"|"$/g, "").toLowerCase();
  if (platform && platform !== "unknown") {
    if (platform === "android") return "android";
    if (platform === "ios") return "ios";
    if (platform === "macos") return "macos";
    if (platform === "windows") return "windows";
    if (platform === "linux") return "linux";

    return "other";
  }

  const agent = headers.get("user-agent") ?? "";
  if (!agent) return undefined;

  // iPhone and iPad before Macintosh: an iPad in mobile mode says "iPad" and also carries "Mac OS
  // X", so asking about the Mac first would file every one of them under macOS.
  if (/iphone|ipad|ipod/i.test(agent)) return "ios";
  if (/android/i.test(agent)) return "android";
  if (/windows/i.test(agent)) return "windows";
  if (/macintosh|mac os x/i.test(agent)) return "macos";
  if (/linux|x11|cros/i.test(agent)) return "linux";

  return "other";
}

/** A CTA press. `position` is required: an unattributed CTA click cannot be acted on. */
export function track(event: "cta_click", properties: { position: CtaPosition }): void;
/** Any other event the browser owns. */
export function track(event: Exclude<BrowserEvent, "cta_click">, properties?: AnalyticsProperties): void;
export function track(event: BrowserEvent, properties?: AnalyticsProperties): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;

  // Sanitising first is also what bounds the size: nine allowlisted keys, each capped at
  // MAX_PROPERTY_LENGTH, cannot add up to MAX_BODY_BYTES. analytics.test.ts asserts that, so there is
  // no length check here to go stale — if the allowlist ever grows past the limit, the test says so.
  const body = JSON.stringify({
    name: event,
    properties: sanitiseBrowserProperties(properties ?? {}),
  });

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
