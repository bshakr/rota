import {
  ArrowRight,
  ArrowRightLeft,
  MessageSquareText,
  Repeat,
  Sparkles,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// The pitch, in the choir's own hues: iris = the thing you act on, sunshine =
// the reminder landing right now, sky = a turn on its way to someone else.
const FEATURES = [
  {
    icon: Repeat,
    coin: "bg-primary/10 text-primary",
    title: "Set it once",
    body: "Bins, kitchen, bathroom — each chore takes turns through your housemates automatically, week after week.",
  },
  {
    icon: MessageSquareText,
    coin: "bg-warning/10 text-warning",
    title: "Texts, not nags",
    body: "Whoever's up gets a text with their own magic link. No app to install, nothing for housemates to sign up for.",
  },
  {
    icon: ArrowRightLeft,
    coin: "bg-info/10 text-info",
    title: "Swaps sort themselves",
    body: "Can't make it? Hand your turn on in one tap — the rota keeps score and everyone stays square.",
  },
] as const;

/**
 * The public landing page — what a logged-out visitor sees at `/` instead of
 * being bounced to a hosted login screen. Pure Solstice: aurora blobs behind
 * frosted panes, Fraunces greeting in the wonky cut, and a working vignette
 * of the product's one idea (a turn, and the text that goes out for it).
 *
 * Every CTA is a plain <a> to /dashboard: that path is proxy-protected, so a
 * logged-out click starts the existing AuthKit sign-in redirect (the proxy
 * may write the PKCE cookie; a page render may not, so getSignInUrl() can't
 * be an href here), and a signed-in click just lands on the dashboard. A
 * plain anchor rather than <Link> on purpose — prefetching a protected route
 * while logged out would only fire cross-origin redirects.
 */
const SIGN_IN_HREF = "/dashboard";

export function Landing() {
  return (
    <div className="relative flex min-h-svh flex-col">
      {/* The weather. Same aurora idiom as the admin chrome, turned up a
          little — this page is allowed to be the sunniest in the house. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-[image:var(--gradient-sunrise)] opacity-70 blur-3xl" />
        <div className="absolute -top-16 -right-28 size-96 rotate-180 rounded-full bg-[image:var(--gradient-sunrise)] opacity-60 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 size-96 rounded-full bg-primary/25 blur-3xl" />
      </div>

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 md:px-8">
        <Wordmark />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <a href={SIGN_IN_HREF}>Sign in</a>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 md:px-8">
        {/* Hero: the greeting on the left, the product's one idea on the right. */}
        <section className="grid items-center gap-12 py-12 md:grid-cols-[minmax(0,1fr)_auto] md:gap-14 md:py-20">
          <div className="animate-pop">
            <Badge variant="outline" className="border-foreground/20 bg-card/60 mb-5">
              <Sparkles aria-hidden />
              The house rota that runs itself
            </Badge>
            <h1 className="font-heading font-wonky max-w-[13ch] text-[2.75rem] leading-[1.05] font-semibold text-balance md:text-6xl">
              Whose turn is it?
            </h1>
            <span
              className="mt-4 block h-1.5 w-16 rounded-full bg-[image:var(--gradient-sunrise)]"
              aria-hidden
            />
            <p className="mt-5 max-w-md text-base text-pretty text-muted-foreground md:text-lg">
              HouseRota keeps the score honest. Set up the chores once and it
              texts whoever&apos;s up — bins, kitchen, bathroom — right when it
              matters.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <a href={SIGN_IN_HREF}>
                  Set up your house
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </a>
              </Button>
              <span className="text-sm text-muted-foreground">
                Two minutes, then it nags so you don&apos;t have to.
              </span>
            </div>
          </div>

          {/* The vignette: one week, one turn, and the text that goes out for
              it — the whole product on a frosted pane. Illustrative fixed
              copy, not live data. */}
          <div className="animate-pop relative mx-auto w-full max-w-sm md:w-80" aria-hidden>
            <div className="pointer-events-none absolute -inset-6" aria-hidden>
              <div className="absolute -top-10 -right-8 size-48 rounded-full bg-[image:var(--gradient-sunrise)] opacity-70 blur-2xl" />
              <div className="absolute -bottom-12 -left-10 size-48 rounded-full bg-primary/30 blur-2xl" />
            </div>

            <div className="relative space-y-3 rounded-2xl border border-border/50 bg-card/55 p-4 shadow-md backdrop-blur-xl">
              <div
                className="animate-rise flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-xs"
                style={{ animationDelay: "120ms" }}
              >
                <span className="animate-float flex size-12 shrink-0 flex-col items-center justify-center rounded-lg bg-[image:var(--gradient-sunrise)] text-foreground shadow-sm">
                  <span className="text-[0.55rem] font-bold tracking-widest uppercase">Jul</span>
                  <span className="font-heading text-lg leading-none font-bold">18</span>
                </span>
                <span className="min-w-0">
                  <span className="font-heading block truncate leading-snug font-semibold">
                    Kitchen deep clean
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    Sat 18 Jul
                    <Badge variant="warning">today</Badge>
                  </span>
                </span>
              </div>

              <ul
                className="animate-rise space-y-1 px-1 text-sm text-muted-foreground"
                style={{ animationDelay: "220ms" }}
              >
                <li className="flex items-center justify-between gap-3 py-1">
                  <span className="truncate">Bins</span>
                  <span className="shrink-0 text-xs">Tue · Bass</span>
                </li>
                <li className="flex items-center justify-between gap-3 py-1">
                  <span className="truncate">Bathroom</span>
                  <span className="shrink-0 text-xs">Thu · Eliza</span>
                </li>
              </ul>

              <div className="animate-rise space-y-1.5" style={{ animationDelay: "320ms" }}>
                <p className="px-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                  The text that goes out
                </p>
                <p className="rounded-xl rounded-bl-sm bg-secondary px-3.5 py-2.5 text-sm text-pretty text-secondary-foreground">
                  Hi Alice! It&apos;s your turn: Kitchen deep clean, this
                  Saturday. Can&apos;t make it? Tap to hand it on 💛
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The three moves. */}
        <section className="grid gap-4 pb-16 sm:grid-cols-3 md:pb-24">
          {FEATURES.map(({ icon: Icon, coin, title, body }, index) => (
            <div
              key={title}
              className="animate-rise rounded-xl border border-border bg-card p-5 shadow-xs"
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <span
                className={`grid size-9 place-items-center rounded-lg ${coin}`}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <h2 className="font-heading mt-3 text-lg leading-snug font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        {/* One last nudge, on the same glass as the hero. */}
        <section className="pb-16 md:pb-24">
          <div className="relative overflow-hidden rounded-3xl border border-border/60 p-2 shadow-sm">
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              <div className="absolute -top-20 -left-12 size-72 rounded-full bg-[image:var(--gradient-sunrise)] opacity-80 blur-2xl" />
              <div className="absolute -right-10 -bottom-20 size-64 rotate-180 rounded-full bg-[image:var(--gradient-sunrise)] opacity-70 blur-2xl" />
            </div>
            <div className="relative flex flex-col items-center gap-5 rounded-2xl border border-border/50 bg-card/55 px-6 py-10 text-center shadow-md backdrop-blur-xl md:py-12">
              <h2 className="font-heading max-w-md text-2xl font-semibold text-balance md:text-3xl">
                Bring peace to the kitchen.
              </h2>
              <p className="max-w-sm text-sm text-pretty text-muted-foreground">
                One person sets it up; everyone else just gets a friendly text
                when it&apos;s their turn.
              </p>
              <Button asChild size="lg">
                <a href={SIGN_IN_HREF}>
                  Start your rota
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-8 md:px-8">
        <Wordmark muted />
        <p className="text-xs text-muted-foreground">Whose turn is it?</p>
      </footer>
    </div>
  );
}
