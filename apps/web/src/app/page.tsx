import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";

// A signpost, not a screen. Once AuthKit lands (BLO-1050) `/` redirects to
// /dashboard for a signed-in admin and to the login flow otherwise. Until then
// it is the quickest way into each of the three surfaces this ticket builds.
const DESTINATIONS = [
  {
    href: "/styleguide",
    title: "Styleguide",
    blurb: "Every token and every component, in both themes.",
  },
  {
    href: "/dashboard",
    title: "Admin shell",
    blurb: "Sidebar, nav, and the five admin screens.",
  },
  {
    href: "/s/demo-token",
    title: "Member page",
    blurb: "No nav, no login. What arrives by text message.",
  },
] as const;

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-5 py-6 md:px-8">
        <Wordmark />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 pb-24">
        <h1 className="font-heading text-display mb-2 font-semibold text-balance">
          Whose turn is it?
        </h1>
        <p className="text-muted-foreground mb-10 text-sm">
          Shell and design system only. The screens themselves land in BLO-1051
          through BLO-1055.
        </p>

        <ul className="flex flex-col gap-3">
          {DESTINATIONS.map(({ href, title, blurb }) => (
            <li key={href}>
              <Button
                asChild
                variant="outline"
                className="h-auto w-full justify-between px-4 py-4"
              >
                <Link href={href}>
                  <span className="flex flex-col items-start gap-0.5 text-left">
                    <span className="font-medium">{title}</span>
                    <span className="text-muted-foreground text-xs font-normal">
                      {blurb}
                    </span>
                  </span>
                  <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
