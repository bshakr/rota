import * as Sentry from "@sentry/nextjs";

import { SuperAdminShell } from "@/components/super-admin-shell";
import { requireSuperAdmin } from "@/lib/auth/super-admin";

/**
 * The operator's area. A route group of its own rather than a corner of
 * `(admin)`, because that layout requires a selected household and wears the
 * house's navigation — and an operator may have no house at all.
 *
 * The AuthKit proxy has already bounced a logged-out visitor to WorkOS (every
 * path that is not explicitly excluded is matched; see proxy-matcher.ts). What
 * this guard adds is the allowlist: anyone else gets `notFound()` and no part of
 * the area renders for them. The URL is not itself a secret — the house shell
 * ships the href in a client chunk for the operators who are shown the link, and
 * the paths are in the plan besides — and it does not need to be. Rails repeats
 * the check on every request it answers; this one only decides what renders.
 *
 * `organizationId` is read for one reason: the shell's "Your house" link points
 * at /dashboard, which requires a household. An operator whose token names no
 * organization would be bounced from there to /setup — whose first offer is a
 * form that CREATES a house — so they are not shown the link at all.
 */
export default async function SuperAdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, organizationId } = await requireSuperAdmin();

  // The same two facts the admin layout records, id only, plus which surface: an
  // operator's error is worth telling apart from a house admin's. No household tag,
  // because an operator may have no house.
  Sentry.setUser({ id: user.id });
  Sentry.setTag("surface", "super-admin");

  return <SuperAdminShell hasHouse={Boolean(organizationId)}>{children}</SuperAdminShell>;
}
