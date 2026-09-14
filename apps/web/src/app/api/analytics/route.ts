import { NextResponse } from "next/server";

import {
  MAX_BODY_BYTES,
  isBrowserEvent,
  isHostname,
  sanitiseBrowserProperties,
  visitContext,
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

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
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

  await forwardAnalyticsEvent(name, enriched);

  // Always 204 once the request itself was well formed. Whether Rails took it is our problem, not
  // the visitor's, and a failure here must never show up as an error in somebody's console.
  return new NextResponse(null, { status: 204 });
}
