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
        // Exact match, or a child route beneath it — /members/12 keeps Members lit.
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 44px tall (py-2.5 + text line) — a nav row is tapped on a phone.
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              // Focus is an offset outline in --sidebar-ring, measured against the
              // sidebar. A ring here was invisible on the clay active item; the
              // offset puts a sidebar-coloured gap between item and outline so it
              // shows on any item background.
              "outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-xs"
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
    <div className="flex min-h-full flex-1">
      {/* Desktop sidebar. Sits one step deeper than the page, like a worktop. */}
      <aside className="bg-sidebar border-sidebar-border hidden w-64 shrink-0 flex-col border-r p-4 md:flex">
        <Link href="/dashboard" className="mb-8 rounded-md px-1 py-1">
          <Wordmark />
        </Link>
        <NavLinks />
        {/* The group name belongs here too, from Rails (/api/me) — deferred to the
            dashboard ticket rather than stubbed with a plausible-looking house name.
            BLO-1050 wires the account footer: who is signed in, and the way out. */}
        <div className="mt-auto flex flex-col gap-3 px-1 pt-4">
          {account}
          <div className="flex items-center justify-end">
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile bar. Only exists below md. */}
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
