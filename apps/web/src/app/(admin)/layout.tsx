import { AdminShell } from "@/components/admin-shell";

/**
 * Everything behind the admin login. BLO-1050 wraps this in AuthKit; until then
 * the shell renders for anyone.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AdminShell>{children}</AdminShell>;
}
