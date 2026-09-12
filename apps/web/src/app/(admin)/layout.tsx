import { requireHousehold } from "@/lib/auth/household";

import { AdminShell } from "@/components/admin-shell";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * The proxy starts login for unauthenticated visitors. This guard also requires
 * a selected household; the API client repeats it because pages and layouts may
 * render concurrently. Setup and the member route live outside this layout.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await requireHousehold();
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;

  return (
    <AdminShell account={<SignOutButton email={user.email} name={name} />}>
      {children}
    </AdminShell>
  );
}
