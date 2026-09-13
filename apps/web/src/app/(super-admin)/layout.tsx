import { SuperAdminShell } from "@/components/super-admin-shell";
import { requireSuperAdmin } from "@/lib/auth/super-admin";

/**
 * The operator's area. A route group of its own rather than a corner of
 * `(admin)`, because that layout requires a selected household and wears the
 * house's navigation — and an operator may have no house at all.
 *
 * The AuthKit proxy has already bounced a logged-out visitor to WorkOS (every
 * path that is not explicitly excluded is matched; see proxy-matcher.ts). What
 * this guard adds is the allowlist: anyone else gets `notFound()`, so the whole
 * area looks like a URL that does not exist. Rails repeats the check on every
 * request it answers — this one only decides what renders.
 *
 * `organizationId` is read for one reason: the shell's "Your house" link points
 * at /dashboard, which requires a household. An operator whose token names no
 * organization would be bounced from there to /setup — whose first offer is a
 * form that CREATES a house — so they are not shown the link at all.
 */
export default async function SuperAdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { organizationId } = await requireSuperAdmin();

  return <SuperAdminShell hasHouse={Boolean(organizationId)}>{children}</SuperAdminShell>;
}
