/**
 * Where a visitor came from, kept across the sign-in wall.
 *
 * The problem this solves is specific. Every CTA on the homepage hands off to WorkOS, which sends
 * the visitor to its own domain and brings them back to `/callback` with a fresh URL. The query
 * string they arrived with — `?utm_source=reddit`, or the `?ref=member` on the link in a housemate's
 * feed — is gone by then, so a house can never be attributed to the thing that brought it. The fix
 * is to write those parameters down on the very first request to `/`, in a cookie that survives the
 * round trip, and hand them to the API once, when the house is named.
 *
 * The cookie is httpOnly (no script needs it, and one that wanted it would be a script we did not
 * put there), SameSite=Lax so it still arrives on the return journey from WorkOS, and Secure outside
 * development. It holds five short strings and expires after thirty days.
 *
 * FIRST touch means first: if the cookie is already set, a later campaign link does not overwrite it,
 * and the API refuses to overwrite a stored value either (see FirstTouch in apps/api). A visitor who
 * arrives with no campaign parameters at all gets no cookie, so "first touch" is precisely "the first
 * visit that carried a campaign" — a direct visit leaves the slot open for one that can be attributed.
 */

export const FIRST_TOUCH_COOKIE = "rm_first_touch";

/** The four UTM parameters plus `ref`. Anything else on the query string is ignored. */
export const FIRST_TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "ref",
] as const;

export type FirstTouchKey = (typeof FIRST_TOUCH_KEYS)[number];
export type FirstTouch = Partial<Record<FirstTouchKey, string>>;

/** Thirty days. Long enough to cover a think-about-it week, short enough not to be a tracking cookie. */
export const FIRST_TOUCH_MAX_AGE = 60 * 60 * 24 * 30;

/** Matches apps/api's FirstTouch::MAX_LENGTH. A campaign name is a label, never a payload. */
export const FIRST_TOUCH_MAX_LENGTH = 200;

/** Trim, cap, drop blanks. Returns null when nothing survives, which is what "no campaign" looks like. */
export function sanitiseFirstTouch(raw: unknown): FirstTouch | null {
  if (typeof raw !== "object" || raw === null) return null;

  const source = raw as Record<string, unknown>;
  const cleaned: FirstTouch = {};
  for (const key of FIRST_TOUCH_KEYS) {
    const value = source[key];
    if (typeof value !== "string") continue;

    const trimmed = value.trim().slice(0, FIRST_TOUCH_MAX_LENGTH);
    if (trimmed) cleaned[key] = trimmed;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/** Reads the five parameters off a landing URL. */
export function firstTouchFromSearchParams(params: URLSearchParams): FirstTouch | null {
  const raw: Record<string, string> = {};
  for (const key of FIRST_TOUCH_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }

  return sanitiseFirstTouch(raw);
}

/**
 * URI-encoded JSON. A raw JSON string in a Set-Cookie header carries commas, semicolons and quotes,
 * every one of which is a cookie delimiter, so the encoding is not decoration.
 *
 * Next's own cookie jar encodes again on the way out, so the wire value is doubly encoded and the
 * request side decodes once before `decodeFirstTouch` decodes the other. That is deliberate rather
 * than accidental: doing our own encoding means the value survives whether or not Next encodes, and
 * `decodeURIComponent` on an already-plain JSON string is a no-op, so both arrangements round-trip.
 */
export function encodeFirstTouch(value: FirstTouch): string {
  return encodeURIComponent(JSON.stringify(value));
}

/** The inverse, and forgiving: a cookie a visitor edited by hand must read as "no campaign", not throw. */
export function decodeFirstTouch(raw: string | undefined): FirstTouch | null {
  if (!raw) return null;

  try {
    return sanitiseFirstTouch(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return null;
  }
}

/** The cookie's attributes. Secure everywhere but development, where localhost is plain http. */
export function firstTouchCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIRST_TOUCH_MAX_AGE,
  };
}
