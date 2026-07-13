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
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
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
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex min-h-full flex-1">
      {/* Desktop sidebar. Sits one step deeper than the page, like a worktop. */}
      <aside className="bg-sidebar border-sidebar-border hidden w-64 shrink-0 flex-col border-r p-4 md:flex">
        <Link href="/dashboard" className="mb-8 rounded-md px-1 py-1">
          <Wordmark />
        </Link>
        <NavLinks />
        <div className="mt-auto flex items-center justify-between px-1 pt-4">
          <span className="text-muted-foreground text-xs">Willow Road</span>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile bar. Only exists below md. */}
        <header className="bg-sidebar border-sidebar-border flex items-center justify-between border-b px-4 py-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
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
            </SheetContent>
          </Sheet>

          <Wordmark />
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
