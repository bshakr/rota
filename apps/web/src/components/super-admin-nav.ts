import { Building2, LayoutDashboard, type LucideIcon, TrendingUp, Wallet } from "lucide-react";

// The operator's surfaces, as data.
//
// Lifted out of `super-admin-shell.tsx` because that file is a Client Component,
// and a value exported from one is a CLIENT REFERENCE: a Server Component that
// imports it gets an opaque proxy, not an array it can read. The overview page
// needs to read `ready` on the server — its spend tile links to /super-admin/spend
// only once that page exists — so the list has to live somewhere both sides can
// actually read it. Nothing about it is client-only; it is four rows of config.

export type SuperAdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** False until the ticket that builds the route lands; see SUPER_ADMIN_NAV. */
  ready: boolean;
};

/**
 * The operator's five surfaces, in the order the plan lists them. The group
 * dashboard (`/super-admin/groups/[id]`) is reached from the Houses list rather
 * than the nav, so four entries cover all five.
 *
 * `ready` is here because the shell ships before the screens do: an entry that
 * is not ready renders as a quiet "Soon" item rather than a link to a 404, and
 * anything else that would link to that surface asks here first. Each later
 * ticket flips its own flag and nothing else:
 *   Traffic  https://linear.app/bloombase/issue/BLO-1682 — landed
 *   Houses   https://linear.app/bloombase/issue/BLO-1676
 *   Spend    https://linear.app/bloombase/issue/BLO-1684
 *
 * "Houses" rather than "Groups": the path keeps the API's noun, the label keeps
 * the product's one.
 */
export const SUPER_ADMIN_NAV: readonly SuperAdminNavItem[] = [
  { href: "/super-admin", label: "Overview", icon: LayoutDashboard, ready: true },
  { href: "/super-admin/traffic", label: "Traffic", icon: TrendingUp, ready: true },
  { href: "/super-admin/groups", label: "Houses", icon: Building2, ready: false },
  { href: "/super-admin/spend", label: "Spend", icon: Wallet, ready: false },
] as const;

/**
 * Does the surface at `href` exist yet?
 *
 * The one question anything outside the nav should ask of this list. A page that
 * hardcodes "spend isn't built" grows a second answer that the ticket flipping
 * the flag will not think to update; a page that asks here changes with the nav.
 *
 * An href that is not in the list is not ready — an unknown surface is not one to
 * send an operator to.
 */
export function isSuperAdminSurfaceReady(href: string): boolean {
  return SUPER_ADMIN_NAV.some((item) => item.href === href && item.ready);
}
