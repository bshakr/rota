import { handleAuth } from "@workos-inc/authkit-nextjs";

import { recordSignIn } from "@/lib/api/sign-in";

// The WorkOS redirect lands here — WORKOS_REDIRECT_URI is http://localhost:3001/callback,
// and it must match the redirect URI registered in the WorkOS dashboard.
//
// handleAuth exchanges the one-time code for a session (PKCE), sets the encrypted
// session cookie, and sends the admin on to the dashboard. It manages its own
// one-shot PKCE cookie, which is exactly why /callback is excluded from the proxy
// matcher (see src/lib/auth/proxy-matcher.ts) — running the session proxy over it
// would only fight that.
export const GET = handleAuth({
  returnPathname: "/dashboard",
  // Behind Railway's proxy, request.nextUrl uses the container's 0.0.0.0:3001
  // origin. AuthKit must redirect to our configured public origin after login.
  baseURL: process.env.APP_URL,
  // The only moment the product can see a sign-in (https://linear.app/bloombase/issue/BLO-1671).
  // An admin who signs in and abandons /setup never calls an authenticated endpoint, so if this
  // hook does not tell Rails, nothing ever does and the number cannot be recovered later.
  //
  // `onSuccess` is the hook AuthKit 4.2.0 actually exposes — confirmed against HandleAuthOptions in
  // node_modules/@workos-inc/authkit-nextjs/dist/esm/types/interfaces.d.ts, where it is typed
  // `(data: HandleAuthSuccessData) => void | Promise<void>` and awaited before the redirect is
  // issued. Which is why `recordSignIn` can never reject and bounds its own wait: a slow or broken
  // Rails must not be able to hold an admin on a blank callback page, let alone fail their sign-in.
  onSuccess: ({ accessToken }) => recordSignIn(accessToken),
});
