import { handleAuth } from "@workos-inc/authkit-nextjs";

import { captureServerEvent } from "@/lib/analytics-server";
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
  //
  // TWO things happen here, and they are not the same thing. `recordSignIn` tells Rails which admin
  // signed in and when, so the operator console can show "last seen"; `signin_completed` adds one
  // anonymous row to the funnel, carrying no user id and no properties at all, because the event
  // store has no visitor identity in it. A sign-in is counted there, never attributed.
  //
  // `user` goes with the token because the token does not carry it
  // (https://linear.app/bloombase/issue/BLO-1696). An AuthKit access token has no `email` and no
  // `name` claim unless the WorkOS JWT template has been configured to add them, so Rails — which
  // sees nothing but the token — had a placeholder address and a null name for every admin. This
  // callback is the one place that holds the real WorkOS user object, so it is the one place that
  // can say. Rails only ever fills a gap with it; it cannot rewrite what WorkOS itself signed.
  //
  // Only the first is awaited. The analytics capture is fire-and-forget on purpose: `onSuccess` is
  // awaited before the redirect is issued, and a point on a chart is not worth a slower login.
  onSuccess: ({ accessToken, user }) => {
    captureServerEvent("signin_completed");
    return recordSignIn(accessToken, user);
  },
});
