import { authkitProxy } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  FIRST_TOUCH_COOKIE,
  encodeFirstTouch,
  firstTouchCookieOptions,
  firstTouchFromSearchParams,
} from "@/lib/first-touch";

// Next 16 replaced `middleware.ts` with `proxy.ts` (node runtime, no edge), and
// AuthKit 4.2.0 ships `authkitProxy` for exactly this file — so this is the native
// Next 16 entry point, not the deprecated middleware. (`authkitMiddleware` still
// exists as a deprecated alias; we don't use it.)
//
// The proxy refreshes the encrypted AuthKit session cookie on every matched
// request and hands the session to `withAuth()` downstream. Two deliberate choices:
//
//   - `redirectUri` is passed explicitly. AuthKit's built-in default reads
//     `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, but this monorepo keeps one root `.env`
//     that names it `WORKOS_REDIRECT_URI` — a server-only var (the redirect URI is
//     public, but there's no reason to inline it into the browser bundle). We hand
//     it in here; the proxy then stamps an `x-redirect-uri` header that
//     `getSignInUrl()` / `withAuth()` reuse when building the sign-in redirect.
//
//   - `middlewareAuth` is ENABLED, and it has to be. `withAuth({ ensureSignedIn: true })`
//     starts sign-in by writing the short-lived PKCE cookie, but Next 16 forbids
//     writing a cookie during a layout/page render ("Cookies can only be modified in
//     a Server Action or Route Handler"). In middleware-auth mode the *proxy* performs
//     the unauthenticated redirect — cookie writes are allowed here — so a logged-out
//     visitor is bounced to WorkOS before the admin layout ever renders. Every matched
//     path therefore requires a session except those in `unauthenticatedPaths`. The
//     member route stays off the matcher entirely (see the exclusions below); the
//     landing page at `/` is public (the page itself redirects a signed-in admin
//     to /dashboard); the styleguide is the one open dev page.
const authkit: NextMiddleware = authkitProxy({
  redirectUri: process.env.WORKOS_REDIRECT_URI,
  middlewareAuth: {
    enabled: true,
    // The sign-in handler owns PKCE initiation; don't bounce it back to itself
    // through proxy-initiated login. The reauth prompt must also remain readable.
    // "/opengraph-image" is not a page but it IS a path without a dot, so the
    // matcher below runs the proxy over it and a logged-out crawler — every
    // crawler — would be 307'd to WorkOS instead of getting the card image.
    // Facebook, Slack and X all fetch it anonymously. robots.txt and sitemap.xml
    // need no entry: they carry a dot, so the matcher already skips them.
    //
    // "/privacy" and "/terms" are linked from the public footer, so a logged-out
    // visitor must be able to read them without being sent to WorkOS first.
    unauthenticatedPaths: [
      "/",
      "/opengraph-image",
      "/styleguide",
      "/auth/sign-in",
      "/auth/reauth",
      "/privacy",
      "/terms",
      // The analytics capture route. A logged-out visitor on the homepage is exactly who posts to
      // it, and it carries no dot, so without this entry the matcher would bounce every event to
      // WorkOS. It writes nothing but an allowlisted event name — see src/app/api/analytics/route.ts.
      "/api/analytics",
    ],
  },
});

// AuthKit first, always. Attribution is stamped onto whatever response it produced, and only ever
// added to it: this wrapper never decides where a request goes, never reads a session, and never
// stands between a logged-out visitor and the WorkOS redirect.
//
// Why here rather than in the `/` page: the query string a visitor arrives with is gone by the time
// WorkOS sends them back, so it has to be written down on the landing request itself, and a Next
// page cannot set a cookie during render ("Cookies can only be modified in a Server Action or Route
// Handler"). The proxy already runs on `/`, and it is allowed to write cookies. See
// src/lib/first-touch.ts for what is stored and why it is httpOnly, Lax and thirty days.
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await authkit(request, event);
  return stampFirstTouch(request, response);
}

type ProxyResult = Awaited<ReturnType<NextMiddleware>>;

/** Adds the first-touch cookie to `response`, or returns it untouched. Never throws, never redirects. */
export function stampFirstTouch(request: NextRequest, response: ProxyResult): ProxyResult {
  // Only the landing page, and only once. A visitor who already has the cookie keeps the campaign
  // that first brought them, which is the whole point of calling it first touch.
  if (request.nextUrl.pathname !== "/") return response;
  if (request.cookies.has(FIRST_TOUCH_COOKIE)) return response;

  const firstTouch = firstTouchFromSearchParams(request.nextUrl.searchParams);
  if (!firstTouch) return response;

  const carrier = response ?? NextResponse.next();
  // A plain `Response` has no cookie jar. AuthKit always hands back a NextResponse, so this is a
  // guard rather than a path — and losing one attribution is the right trade against rebuilding an
  // auth response we do not fully understand.
  const jar = (carrier as Partial<NextResponse>).cookies;
  if (!jar) return response;

  jar.set(FIRST_TOUCH_COOKIE, encodeFirstTouch(firstTouch), firstTouchCookieOptions());
  return carrier;
}

// The matcher MUST be an inline literal: Next statically parses this field at
// build time and rejects an imported constant. Its logic — and the assertion that
// `/s/[token]` and `/callback` are excluded — lives in src/lib/auth/proxy-matcher.ts
// (`PROXY_MATCHER`), and proxy-matcher.test.ts asserts this literal stays in sync.
//
// Runs the proxy on everything EXCEPT: household entry (`h/…`, public), the member magic-link route (`s/…`, public,
// token-authenticated — must never be intercepted), the OAuth callback (owns its
// own PKCE cookie), Next internals (`_next/`), and static files (`*.*`).
export const config = {
  matcher: ["/((?!s/|h/|callback|_next/|.*\\..*).*)"],
};
