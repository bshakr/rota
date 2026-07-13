// The single source of truth for which paths AuthKit's proxy runs on. `proxy.ts`
// hands `PROXY_MATCHER` to Next; `proxyMatches()` compiles the same pattern so a
// test can prove — without importing AuthKit or `next/server` — that the member
// magic-link route is never intercepted.
//
// The matcher runs the proxy on everything EXCEPT:
//   - `s/...`    the member magic-link page. PUBLIC, authenticated by the member
//                token rather than a WorkOS session, so AuthKit must never touch
//                it. Getting this wrong breaks every SMS link we will ever send.
//   - `callback` the OAuth callback owns its own one-shot PKCE cookie via
//                `handleAuth`; running the session proxy over it only fights that.
//   - `_next/`   framework internals.
//   - `*.*`      static files (favicon, icons, images). A catch-all proxy would
//                otherwise intercept them and break styling — see the AuthKit
//                README's Tailwind v4 warning.
//
// Everything else — `/`, `/dashboard`, `/members`, … — is covered, which is what
// lets the admin layout call `withAuth()` (it requires the proxy to have run).
export const PROXY_MATCHER = "/((?!s/|callback|_next/|.*\\..*).*)";

/** True when the AuthKit proxy runs on `pathname`. Mirrors what Next does with `PROXY_MATCHER`. */
export function proxyMatches(pathname: string): boolean {
  return new RegExp(`^${PROXY_MATCHER}$`).test(pathname);
}
