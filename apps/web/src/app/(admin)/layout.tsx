import { requireHousehold } from "@/lib/auth/household";
import { isSuperAdmin } from "@/lib/auth/super-admin";

import { AdminShell } from "@/components/admin-shell";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * The proxy starts login for unauthenticated visitors. This guard also requires
 * a selected household; the API client repeats it because pages and layouts may
 * render concurrently. Setup and the member route live outside this layout.
 *
 * The super admin allowlist is read HERE, on the server, and only the boolean
 * crosses into the client shell — the ids themselves never reach the browser.
 * It is a display decision and nothing more: the area guards itself, and Rails
 * guards the data.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await requireHousehold();
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;

  return (
    <AdminShell
      account={<SignOutButton email={user.email} name={name} />}
      superAdmin={isSuperAdmin(user.id)}
    >
      {children}
    </AdminShell>
  );
}
