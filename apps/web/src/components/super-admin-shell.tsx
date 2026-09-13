"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, House, LayoutDashboard, type LucideIcon, TrendingUp, Wallet } from "lucide-react";

import { Container } from "@/components/container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

type NavItem = {
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
 * is not ready renders as a quiet "Soon" item rather than a link to a 404. Each
 * later ticket flips its own flag and nothing else:
 *   Traffic  https://linear.app/bloombase/issue/BLO-1682
 *   Houses   https://linear.app/bloombase/issue/BLO-1676
 *   Spend    https://linear.app/bloombase/issue/BLO-1684
 *
 * "Houses" rather than "Groups": the path keeps the API's noun, the label keeps
 * the product's one.
 */
export const SUPER_ADMIN_NAV: readonly NavItem[] = [
  { href: "/super-admin", label: "Overview", icon: LayoutDashboard, ready: true },
  { href: "/super-admin/traffic", label: "Traffic", icon: TrendingUp, ready: false },
  { href: "/super-admin/groups", label: "Houses", icon: Building2, ready: false },
  { href: "/super-admin/spend", label: "Spend", icon: Wallet, ready: false },
] as const;

/** The shared pill geometry. A nav row is tapped on a phone, so it is 44px tall. */
const NAV_ITEM =
  "flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors";

function NavLinks() {
  const pathname = usePathname();

  return (
    // Horizontal, not a sidebar: the house wears a sidebar, and HQ must not be
    // mistakable for a house at a glance. Scrolls rather than wraps on a phone.
    <nav aria-label="Super admin" className="flex items-center gap-1 overflow-x-auto py-3">
      {SUPER_ADMIN_NAV.map(({ href, label, icon: Icon, ready }) => {
        // Overview is the root of the area, so it matches exactly; everything
        // else keeps its child routes lit (/super-admin/groups/12 → Houses).
        const active =
          href === "/super-admin"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

        if (!ready) {
          return (
            <span
              key={href}
              aria-disabled="true"
              className={cn(NAV_ITEM, "text-muted-foreground cursor-default")}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {label}
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase">
                Soon
              </span>
            </span>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              NAV_ITEM,
              "outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              // The same "you are here" idiom as the house sidebar — a lilac
              // pill pressed into the page — so only the chrome around it is
              // different, not the language.
              active
                ? "bg-secondary text-secondary-foreground font-semibold shadow-xs [&_svg]:text-link"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The super admin shell.
 *
 * One job beyond navigation: this area must never be mistaken for a house. Two
 * things do that. A PLUM BAND across the top — the one surface in the product
 * that is plum in BOTH themes, carrying the wordmark and a peach HQ sticker, so
 * a screenshot of this page is unambiguous whichever theme it was taken in. And
 * a horizontal nav where the house has a sidebar, so the shape of the page
 * differs before a single word is read.
 *
 * Everything below the band is ordinary Soft Clay on the ordinary page.
 *
 * There is no account footer and no sign-out here, deliberately: the operator is
 * signed in to their house in the same session, and the band's way back to it is
 * the only exit this area needs.
 */
export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* bg-plum is theme-independent on purpose (a sticker does not invert), so
          the ink on it is pinned to light pigments rather than semantic cuts —
          including the focus outline, because the grape --ring is all but
          invisible on plum ink. */}
      <header className="bg-plum border-border text-lavender border-b shadow-sm">
        <Container className="flex h-14 items-center justify-between gap-3">
          <Link
            href="/super-admin"
            className="flex items-center gap-2.5 rounded-full outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lavender"
          >
            <Wordmark onPlum />
            <span className="bg-peach text-plum font-heading rounded-full px-2 py-0.5 text-xs font-bold tracking-[0.18em] uppercase shadow-xs">
              HQ
            </span>
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="hover:bg-lavender/15 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender"
            >
              <House className="size-4 shrink-0" aria-hidden />
              Your house
            </Link>
            <ThemeToggle />
          </div>
        </Container>
      </header>

      <Container>
        <NavLinks />
      </Container>

      <Container asChild>
        <main className="flex-1 pt-2 pb-14">{children}</main>
      </Container>
    </div>
  );
}
