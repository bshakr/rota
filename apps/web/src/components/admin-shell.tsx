"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  MessageSquare,
  Repeat,
  Users,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * The admin surface, one entry per screen in the spec. Downstream tickets add
 * their route here rather than inventing their own navigation.
 */
export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/members", label: "Members", icon: Users },
  { href: "/rotas", label: "Rotas", icon: Repeat },
  { href: "/shifts", label: "Shifts", icon: CalendarDays },
  { href: "/sms", label: "SMS log", icon: MessageSquare },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {ADMIN_NAV.map(({ href, label, icon: Icon }) => {
        // Exact match, or a child route beneath it. /members/12 keeps Members lit.
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              // A PILL, 44px tall (py-2.5 + the text line): a nav row is tapped
              // on a phone, and in Soft Clay everything tappable is a pill.
              "flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors",
              // Focus is an offset outline in --sidebar-ring, measured against the
              // sidebar. The offset puts a sidebar-coloured gap between item and
              // outline so it shows on any item background.
              "outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
              // "You are here" is a LILAC PILL pressed into the panel: the quiet
              // secondary fill, the soft clay squash, and the icon in grape (the
              // text cut of it, so it lifts at night). Hover is the same family
              // one step quieter, so rest, hover and active read as one idea
              // getting progressively more certain.
              active
                ? "bg-secondary text-secondary-foreground font-semibold shadow-xs [&_svg]:text-link"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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
 * The authenticated admin shell: persistent sidebar on desktop, a drawer behind
 * a hamburger on mobile. Deliberately the opposite of the member layout, which
 * has no navigation at all because members are not logged in and have exactly
 * one thing to do.
 */
export function AdminShell({
  children,
  account,
}: {
  children: React.ReactNode;
  /** The signed-in admin's identity + sign-out, wired by the (admin) layout (BLO-1050). */
  account?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative flex min-h-full flex-1">
      {/* Desktop sidebar. A WHITE CLAY PANEL floating on the lavender page: the
          largest radius in the system (32px), lit from above and squashed below
          by the clay recipe, detached from the window edge so the page frames
          it. No glass, and nothing drifting behind it. Chrome holds still; the
          blobs are saved for the hero. Sticky, so the panel stays put while the
          page scrolls, and the wrapper's padding is what it floats in. */}
      <div className="hidden shrink-0 p-3 md:block">
        <aside className="bg-sidebar border-sidebar-border sticky top-3 flex h-[calc(100svh-1.5rem)] w-60 flex-col overflow-y-auto rounded-4xl border p-4 shadow-sm">
          {/* Wordmark + theme toggle share the top row, mirroring the mobile
              header, which leaves the footer purely about the account. */}
          <div className="mb-6 flex items-center justify-between gap-2">
            <Link href="/dashboard" className="rounded-full px-1 py-1">
              <Wordmark />
            </Link>
            <ThemeToggle />
          </div>
          <NavLinks />
          {/* The account footer: who is signed in, and the way out (wired by the
              (admin) layout, BLO-1050). The hairline bleeds to the panel edges,
              a card-footer seam rather than a floating rule. */}
          <div className="border-sidebar-border -mx-4 mt-auto border-t px-4 pt-3">
            {account}
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile bar. Only exists below md: the same white clay, worn flat
            against the top of the screen rather than floating. */}
        <header className="bg-sidebar border-sidebar-border flex items-center justify-between border-b px-4 py-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              {/* icon-lg (44px): the primary mobile control. */}
              <Button variant="ghost" size="icon-lg" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-72 p-4">
              <SheetHeader className="p-0">
                <SheetTitle asChild>
                  <Wordmark className="mb-6" />
                </SheetTitle>
              </SheetHeader>
              <NavLinks onNavigate={() => setOpen(false)} />
              {account ? (
                <div className="border-sidebar-border mt-6 border-t pt-4">{account}</div>
              ) : null}
            </SheetContent>
          </Sheet>

          <Wordmark />
          <ThemeToggle />
        </header>

        <Container asChild>
          <main className="flex-1 py-6 md:py-10">{children}</main>
        </Container>
      </div>
    </div>
  );
}
