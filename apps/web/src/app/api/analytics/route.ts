import { createHash, createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import {
  MAX_BODY_BYTES,
  isBrowserEvent,
  isHostname,
  sanitiseBrowserProperties,
  visitContext,
  type BrowserEvent,
  type CtaPosition,
  CTA_POSITIONS,
} from "@/lib/analytics";
import { analyticsConfigured, forwardAnalyticsEvent } from "@/lib/analytics-server";
import { createTokenBucket } from "@/lib/rate-limit";

/**
 * The only endpoint in this app a stranger may write to, so everything here is about keeping that
 * small.
 *
 * What it accepts: one of the THREE events a browser owns, with allowlisted properties, in a body
 * under 2 KB, at a limited rate per IP. What it does with it: adds the few things only this side can
 * know, then forwards it server-to-server to Rails behind ANALYTICS_SHARED_SECRET, which the browser
 * never sees.
 *
 * Those few things are the visitor's COUNTRY, CITY, DEVICE CLASS, BROWSER FAMILY and OS FAMILY, read
 * off request headers and merged over the sanitised body so a client-supplied one can never survive.
 * Not one of them is an identifier and not one is derived from the IP: the country and the city are
 * Cloudflare's own headers, and the other three are one word each from a closed set, taken from
 * client hints. No version number is kept, of the browser or of the system. The IP is used for the
 * rate limiter's bucket and is never stored, logged or forwarded, and the user agent is matched and
 * discarded without being kept either. See `visitContext` in src/lib/analytics.ts, which also lists
 * the Cloudflare location headers this app deliberately never reads.
 *
 * It also computes one thing that is not a property and never becomes one: the DAILY VISITOR CODE,
 * a hash of the address and the agent with a salt that changes at midnight UTC, sent to Rails in
 * its own header so that "how many browsers" can be counted beside "how many visits" without a
 * cookie and without anything in a row to join two visits together with. See `visitorDigest` below,
 * which is where the argument for it lives.
 *
 * What it cannot do, by construction: create an event that belongs to a house. `first_text_delivered`
 * is the number this whole wave exists to measure, and the boundary that stops a visitor forging one
 * is this allowlist plus the narrower one Rails enforces on arrival.
 *
 * It is on the AuthKit proxy's `unauthenticatedPaths` because a logged-out visitor on the homepage is
 * exactly who sends these, and a path with no dot would otherwise be bounced to WorkOS.
 */

// Live, per-request. Nothing here is cacheable and a prerender would be meaningless.
export const dynamic = "force-dynamic";

// Twenty in a burst, refilling at one every three seconds. A real visitor sends three events on a
// homepage visit; a loop gets a trickle. Per instance — see src/lib/rate-limit.ts for why that is
// acceptable for this endpoint and would not be for anything guarding money or credentials.
const limiter = createTokenBucket({ capacity: 20, refillPerSecond: 1 / 3 });

function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || undefined;

  return request.headers.get("x-real-ip")?.trim() || undefined;
}

// Everything behind one proxy would otherwise share a bucket. "unknown" is a bucket of its own, and
// a deploy with no proxy in front of it has no other answer to give.
function clientKey(request: Request): string {
  return clientIp(request) ?? "unknown";
}

/**
 * The daily visitor code: how this site counts VISITORS without a cookie and without keeping
 * anything that could name one.
 *
 * `sha256(hmac_sha256(secret, "visitor-salt:" + today in UTC) + "|" + ip + "|" + user agent)`.
 *
 * Read it in two halves. The inner HMAC is a SALT for the day, derived from the shared secret and
 * the UTC date, held for the length of one request and never written down. The outer hash mixes that
 * salt with the two things this request already carried — the address it came from and the string
 * the browser says it is — into sixty-four characters of hex.
 *
 * What that buys, and what it deliberately does not:
 *
 *   - Two visits from one browser on one day produce the SAME code, so Rails can tell that the
 *     second one is not a new visitor.
 *   - The same browser tomorrow produces a DIFFERENT code, because the salt has changed, and there
 *     is no kept copy of yesterday's salt to recompute the old one with. Nobody, including us, can
 *     match a code across a midnight. That is the whole reason there is no "returning visitors"
 *     figure anywhere in this product.
 *   - The code cannot be turned back into an address. It is a hash of a secret nobody outside this
 *     process has, so guessing it needs the secret as well as the address.
 *
 * Landing views only. A `cta_click` happens on a page whose visit was already counted, and giving
 * the other two events a code would put the same identifier on three rows of the same visit, which
 * is exactly the join this table is built not to have.
 *
 * No secret, no code. The events still flow: a deploy with no ANALYTICS_SHARED_SECRET simply counts
 * visits and not visitors, which is where this product was last week.
 *
 * The address and the agent are both things this handler ALREADY reads — the address for the rate
 * limiter's bucket, the agent for the device, browser and system families — and neither is stored,
 * logged or forwarded. What leaves this function is the hex, and it travels in a header rather than
 * in the properties (see forwardAnalyticsEvent), so there is no path by which it can be written into
 * a row.
 */
function visitorDigest(request: Request, name: BrowserEvent): string | undefined {
  if (name !== "landing_view") return undefined;

  const secret = process.env.ANALYTICS_SHARED_SECRET?.trim();
  if (!secret) return undefined;

  // No address means no visitor to be the same as. A shared "unknown" code would count every
  // visit with no proxy header in front of it as one browser, which is a made-up number rather
  // than a missing one.
  const ip = clientIp(request);
  if (!ip) return undefined;

  const day = new Date().toISOString().slice(0, 10);
  const salt = createHmac("sha256", secret).update(`visitor-salt:${day}`).digest("hex");
  const agent = request.headers.get("user-agent")?.trim() ?? "";

  return createHash("sha256").update(`${salt}|${ip}|${agent}`).digest("hex");
}

export async function POST(request: Request): Promise<NextResponse> {
  // Refuse a big body before reading it, when the sender was honest enough to declare its size.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  if (!limiter.take(clientKey(request))) {
    return new NextResponse(null, { status: 429 });
  }

  const body = await request.text();
  // And again on what actually arrived, for a sender who was not.
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null) {
    return new NextResponse(null, { status: 400 });
  }

  const { name, properties } = payload as { name?: unknown; properties?: unknown };
  if (!isBrowserEvent(name)) {
    return new NextResponse(null, { status: 400 });
  }

  // Against the BROWSER allowlist, which is what drops a `country`, a `city`, a `device`, a
  // `browser` or an `os` somebody posted by hand. They are not deleted afterwards; they were never
  // copied across in the first place.
  const cleaned = sanitiseBrowserProperties(properties);

  // The one property with a closed set of values. A position we do not recognise is dropped rather
  // than stored, so the CTA breakdown can never grow a fourth bar nobody put there.
  if (cleaned.position && !CTA_POSITIONS.includes(cleaned.position as CtaPosition)) {
    delete cleaned.position;
  }

  // The page already dropped the path and the query from `document.referrer` and sent only the host.
  // Checked again here because a stranger with curl did not: a referrer table is read by a person,
  // and an entry that is really a sentence somebody chose is how a dashboard gets used as a
  // noticeboard.
  if (cleaned.referrer_host && !isHostname(String(cleaned.referrer_host))) {
    delete cleaned.referrer_host;
  }

  // Last, so the headers win over anything the body claimed.
  const enriched = { ...cleaned, ...visitContext(request.headers) };

  // Nothing configured means nothing to forward, and that is not the sender's problem: a 204 keeps
  // the browser quiet in a deploy that simply has no analytics.
  if (!analyticsConfigured()) {
    return new NextResponse(null, { status: 204 });
  }

  await forwardAnalyticsEvent(name, enriched, visitorDigest(request, name));

  // Always 204 once the request itself was well formed. Whether Rails took it is our problem, not
  // the visitor's, and a failure here must never show up as an error in somebody's console.
  return new NextResponse(null, { status: 204 });
}
