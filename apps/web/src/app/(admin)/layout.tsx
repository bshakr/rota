import * as Sentry from "@sentry/nextjs";

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
  const { user, organizationId } = await requireHousehold();
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;

  // Who and which household, on every event this request produces. The Node SDK
  // scopes both to the request, so one admin's id never rides along on another's
  // error. The WorkOS user id ONLY: an email or a name would put a person into
  // Sentry, which the privacy contract rules out, and an opaque id is enough to
  // ask "is this one admin or all of them". The member layout and the household
  // entry page set nothing at all, deliberately.
  Sentry.setUser({ id: user.id });
  Sentry.setTag("household", organizationId);

  return (
    <AdminShell
      account={<SignOutButton email={user.email} name={name} />}
      superAdmin={isSuperAdmin(user.id)}
    >
      {children}
    </AdminShell>
  );
}
