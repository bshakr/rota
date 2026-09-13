"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";

import { Container } from "@/components/container";
// The nav list lives in its own module, not here: a value exported from a Client
// Component is a client reference, and the overview page reads `ready` on the
// server to decide whether its spend tile may link anywhere yet.
import { SUPER_ADMIN_NAV } from "@/components/super-admin-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

/**
 * The shared pill geometry. A nav row is tapped on a phone, so it is 44px tall —
 * the system's comfortable touch target, and the height `size-lg`/`icon-lg` use.
 * `min-h-11` states that outright: padding plus a 20px line box came to 40, which
 * looked like the intent but was not it.
 */
const NAV_ITEM =
  "flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors";

function NavLinks() {
  const pathname = usePathname();

  return (
    // Horizontal, not a sidebar: the house wears a sidebar, and HQ must not be
    // mistakable for a house at a glance.
    //
    // WRAPS rather than scrolls. A horizontally scrolling row put "Spend" off
    // the right edge at phone width with no way to reach it from a keyboard —
    // the row has one focusable child and no scroll affordance of its own
    // (WCAG 2.1.1) — and the scroll box clipped each item's offset focus ring.
    // Wrapping costs a second line on a narrow screen and nothing anywhere else.
    <nav aria-label="Super admin" className="flex flex-wrap items-center gap-1 py-3">
      {SUPER_ADMIN_NAV.map(({ href, label, icon: Icon, ready }) => {
        // Overview is the root of the area, so it matches exactly; everything
        // else keeps its child routes lit (/super-admin/groups/12 → Houses).
        const active =
          href === "/super-admin"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

        if (!ready) {
          // No `aria-disabled`: it is not allowed on a generic span, and there
          // is nothing here to disable. The word "Soon" is the meaning, and it
          // is read out as part of the text.
          //
          // TEXT, not a chip. A quiet fill here sits pastel-on-pastel — the
          // `--muted` pill measured 1.07:1 against the page — so the fill was
          // decoration that could not be seen doing its job. Micro-type in the
          // same muted ink carries the same meaning and is legible by
          // construction, because it is type rather than a surface.
          return (
            <span key={href} className={cn(NAV_ITEM, "text-muted-foreground cursor-default")}>
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {label}
              <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">Soon</span>
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
 *
 * `hasHouse` is not cosmetic. /dashboard requires a household, so an operator
 * with no organization on their token would be bounced from that link to /setup,
 * where the next thing on screen is a form that creates a house. Offering the
 * way back only to someone who has one to go back to is the whole point of the
 * flag.
 */
export function SuperAdminShell({
  children,
  hasHouse,
}: {
  children: React.ReactNode;
  /** Does this operator's session name a household? The layout reads it off the token. */
  hasHouse: boolean;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* bg-plum is theme-independent on purpose (a sticker does not invert), so
          the ink on it is pinned to light pigments rather than semantic cuts —
          including the focus outline, because the grape --ring is all but
          invisible on plum ink.
          The hairline follows the same rule. `--border` is plum at 12%: plum on
          plum, which is nothing at all by day. A lavender hairline reads on the
          band in both registers, and it is the edge that separates the band from
          the page at night, where the two plums are only a lightness step apart.
          check-theme-parity.mjs measures all of these against the band. */}
      <header className="bg-plum text-lavender border-lavender/20 border-b shadow-sm">
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
            {hasHouse ? (
              <Link
                href="/dashboard"
                /* Same 44px target as a nav item and as the toggle beside it:
                   three controls in one row should not be three heights. */
                className="hover:bg-lavender/15 flex min-h-11 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender"
              >
                <House className="size-4 shrink-0" aria-hidden />
                Your house
              </Link>
            ) : null}
            {/* The toggle is a ghost Button, and ghost's hover tint and focus
                ring are measured against the PAGE. On plum they are illegible,
                so the band hands the control its own — the same lavender the
                links beside it use. */}
            <ThemeToggle className="hover:bg-lavender/15 hover:text-lavender aria-expanded:bg-lavender/15 aria-expanded:text-lavender size-11 focus-visible:outline-lavender" />
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
