"use server";

import { signOut } from "@workos-inc/authkit-nextjs";

import { siteUrl } from "@/lib/site";

// Sign-out is a mutation (it clears the encrypted session cookie), so it is a
// server action, invoked from a form in <SignOutButton>. `signOut` clears the
// cookie and performs the redirect itself — control never returns past it.
//
// `returnTo` MUST be absolute. With a live session, authkit sends the browser to
// WorkOS's logout endpoint carrying `return_to`, and WorkOS only honours an
// absolute URL: a relative one is dropped and it falls back to the "App homepage
// URL" in the dashboard's Redirects settings, which this app has never set — so
// signing out landed on error.workos.com/user_management/app-homepage-url-not-found
// instead of the homepage. `siteUrl("/")` builds it from APP_URL, the same origin
// the callback route and the metadata use, so a preview deploy returns to itself.
// (Without a session authkit plain-redirects to `returnTo`, which is why a
// relative "/" looked fine in some local runs.)
export async function signOutAction(): Promise<void> {
  await signOut({ returnTo: siteUrl("/") });
}
