"use server";

import { signOut } from "@workos-inc/authkit-nextjs";

// Sign-out is a mutation (it clears the encrypted session cookie), so it is a
// server action, invoked from a form in <SignOutButton>. `signOut` clears the
// cookie and performs the redirect itself — control never returns past it.
export async function signOutAction(): Promise<void> {
  await signOut({ returnTo: "/" });
}
