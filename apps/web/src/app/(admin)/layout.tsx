import { withAuth } from "@workos-inc/authkit-nextjs";

import { AdminShell } from "@/components/admin-shell";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * Everything behind the admin login. `withAuth({ ensureSignedIn: true })` redirects
 * an unauthenticated visitor to WorkOS before any admin screen renders — this is
 * the one place admin auth is enforced (the proxy covers these routes but does not
 * itself redirect; see proxy.ts). The member route `/s/[token]` is in a separate
 * route group and is deliberately not under this layout.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await withAuth({ ensureSignedIn: true });

  return (
    <AdminShell account={<SignOutButton email={user.email} />}>{children}</AdminShell>
  );
}
