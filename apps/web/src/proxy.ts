import { authkitProxy } from "@workos-inc/authkit-nextjs";

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
export default authkitProxy({
  redirectUri: process.env.WORKOS_REDIRECT_URI,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/", "/styleguide"],
  },
});

// The matcher MUST be an inline literal: Next statically parses this field at
// build time and rejects an imported constant. Its logic — and the assertion that
// `/s/[token]` and `/callback` are excluded — lives in src/lib/auth/proxy-matcher.ts
// (`PROXY_MATCHER`), and proxy-matcher.test.ts asserts this literal stays in sync.
//
// Runs the proxy on everything EXCEPT: the member magic-link route (`s/…`, public,
// token-authenticated — must never be intercepted), the OAuth callback (owns its
// own PKCE cookie), Next internals (`_next/`), and static files (`*.*`).
export const config = {
  matcher: ["/((?!s/|callback|_next/|.*\\..*).*)"],
};
