// The single source of truth for which paths AuthKit's proxy runs on. `proxy.ts`
// hands `PROXY_MATCHER` to Next; `proxyMatches()` compiles the same pattern so a
// test can prove — without importing AuthKit or `next/server` — that the member
// magic-link route is never intercepted.
//
// The matcher runs the proxy on everything EXCEPT:
//   - `h/...`    household entry, public and limited to admin-added members.
//   - `s/...`    the member magic-link page. PUBLIC, authenticated by the member
//                token rather than a WorkOS session, so AuthKit must never touch
//                it. Getting this wrong breaks every SMS link we will ever send.
//   - `callback` the OAuth callback owns its own one-shot PKCE cookie via
//                `handleAuth`; running the session proxy over it only fights that.
//   - `monitoring` the Sentry tunnel route (next.config.ts `tunnelRoute`). Browser
//                error events are POSTed here and forwarded to Sentry. A member's
//                browser on `/s/<token>` has no WorkOS session, so under the proxy
//                every one of their error reports would be answered with a redirect
//                to sign-in instead of being delivered. It is excluded rather than
//                added to `unauthenticatedPaths` because that would still run the
//                session refresh over every event POST for nothing.
//   - `_next/`   framework internals.
//   - `*.*`      static files (favicon, icons, images). A catch-all proxy would
//                otherwise intercept them and break styling — see the AuthKit
//                README's Tailwind v4 warning.
//
// Everything else — `/`, `/dashboard`, `/members`, … — is covered, which is what
// lets the admin layout call `withAuth()` (it requires the proxy to have run).
export const PROXY_MATCHER = "/((?!s/|h/|callback|monitoring|_next/|.*\\..*).*)";

/** True when the AuthKit proxy runs on `pathname`. Mirrors what Next does with `PROXY_MATCHER`. */
export function proxyMatches(pathname: string): boolean {
  return new RegExp(`^${PROXY_MATCHER}$`).test(pathname);
}
