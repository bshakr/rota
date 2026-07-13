import { handleAuth } from "@workos-inc/authkit-nextjs";

// The WorkOS redirect lands here — WORKOS_REDIRECT_URI is http://localhost:3001/callback,
// and it must match the redirect URI registered in the WorkOS dashboard.
//
// handleAuth exchanges the one-time code for a session (PKCE), sets the encrypted
// session cookie, and sends the admin on to the dashboard. It manages its own
// one-shot PKCE cookie, which is exactly why /callback is excluded from the proxy
// matcher (see src/lib/auth/proxy-matcher.ts) — running the session proxy over it
// would only fight that.
export const GET = handleAuth({ returnPathname: "/dashboard" });
