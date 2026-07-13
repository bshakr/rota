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
//   - `middlewareAuth` is left disabled. Auth is enforced in one obvious, testable
//     place — the admin layout's `withAuth({ ensureSignedIn: true })` — rather than
//     by an allowlist here, which also lets the member route stay entirely off the
//     matcher (see the exclusions below).
export default authkitProxy({
  redirectUri: process.env.WORKOS_REDIRECT_URI,
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
