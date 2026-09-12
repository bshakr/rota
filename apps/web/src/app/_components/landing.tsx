import { ArrowRight, ArrowRightLeft, MessageSquareText, Repeat } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The three moves, each wearing its own sticker from the pastel sheet: mint for
 * the thing that quietly keeps going, lemon for the text landing right now, sky
 * for a turn on its way to somebody else. The coins use the THEME-INDEPENDENT
 * pastels paired with `text-plum`, because a sticker is a physical object and
 * does not invert at night.
 */
const FEATURES = [
  {
    icon: Repeat,
    coin: "bg-mint",
    title: "Set it once",
    body: "Add each chore, say who takes turns, and it keeps going round on its own. Bins on Tuesday, bathroom on Thursday, week after week.",
  },
  {
    icon: MessageSquareText,
    coin: "bg-lemon",
    title: "Texts, not nags",
    body: "Whoever is up gets a text with their own link. No app to install, and nothing for your housemates to sign up for.",
  },
  {
    icon: ArrowRightLeft,
    coin: "bg-sky",
    title: "Swaps sort themselves",
    body: "Busy this week? Hand your turn on in one tap. The rota updates itself, and everybody can see where it landed.",
  },
] as const;

/**
 * Blob geometry. An ellipse pulled out of round on both axes, so the shapes
 * read as pressed clay rather than circles. Three different sets keep them from
 * looking like triplets. These have to be inline styles: they are one-off
 * organic values, not a scale worth publishing as utilities.
 */
const BLOB_SHAPES = {
  corner: "58% 42% 45% 55% / 55% 48% 52% 45%",
  under: "44% 56% 62% 38% / 48% 58% 42% 52%",
  over: "62% 38% 48% 52% / 40% 55% 45% 60%",
} as const;

/**
 * The public landing page, which is what a logged-out visitor sees at `/`
 * instead of being bounced to a hosted login screen. Soft Clay throughout: a
 * lavender pane holding the pitch, pastel blobs bobbing behind it, and a
 * working vignette of the product's one idea, which is a turn and the text that
 * goes out for it.
 *
 * Every CTA is a plain <a> to /dashboard. That path is proxy-protected, so a
 * logged-out click starts the existing AuthKit sign-in redirect (the proxy may
 * write the PKCE cookie; a page render may not, so getSignInUrl() cannot be an
 * href here), and a signed-in click simply lands on the dashboard. A plain
 * anchor rather than <Link> on purpose: prefetching a protected route while
 * logged out would only fire cross-origin redirects.
 */
const SIGN_IN_HREF = "/dashboard";

export function Landing() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 md:px-8">
        <Wordmark />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <a href={SIGN_IN_HREF}>Sign in</a>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 md:px-8">
        {/* The hero band: a 32px lavender pane, the one place on the site where
            the paper goes a shade deeper. At night it becomes a plum panel
            instead, because `bg-lavender-pane` is a fixed pastel and plain
            `text-foreground` would go white on it. */}
        <section className="relative overflow-hidden rounded-4xl bg-lavender-pane px-6 py-10 shadow-sm md:px-12 md:py-16 dark:bg-card">
          {/* One blob in the top corner, clipped by the pane. The other two sit
              around the vignette below, which keeps all three off the headline
              and the paragraph at every width. They bob on a 6s loop, offset so
              they never move in step, and the reduced-motion block in
              globals.css stops them dead rather than speeding them up. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <span
              className="animate-bob absolute -top-16 -right-16 size-32 bg-peach shadow-sm md:-top-20 md:-right-20 md:size-56"
              style={{ borderRadius: BLOB_SHAPES.corner }}
            />
          </div>

          <div className="relative grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
            <div className="animate-pop">
              <Badge
                variant="outline"
                className="mb-5 h-7 rounded-full border-border bg-card px-3.5 text-[0.8125rem] shadow-xs dark:bg-background"
              >
                Gently nags. Never bites.
              </Badge>
              <h1 className="font-heading max-w-[12ch] text-display font-semibold text-balance md:text-6xl">
                Whose turn? Sorted.
              </h1>
              <p className="mt-5 max-w-md text-base text-pretty text-muted-foreground md:text-lg">
                Set the chores up once. Rota Monster texts whoever&apos;s up
                next, and handing a turn on is one tap. Nobody has to nag.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
                <Button asChild size="lg">
                  <a href={SIGN_IN_HREF}>
                    Set up your house
                    <ArrowRight data-icon="inline-end" aria-hidden />
                  </a>
                </Button>
                <span className="text-sm text-muted-foreground">
                  Two minutes, promise.
                </span>
              </div>
            </div>

            {/* The vignette: one week, one turn, and the text that goes out for
                it. Illustrative fixed copy rather than live data, and hidden
                from assistive tech because it is a picture of the product, not
                a second copy of the pitch. */}
            <div className="relative mx-auto w-full max-w-sm md:w-[21rem]" aria-hidden>
              <div className="pointer-events-none absolute inset-0">
                <span
                  className="animate-bob absolute -bottom-12 -left-10 size-28 bg-mint shadow-sm md:size-36"
                  style={{ borderRadius: BLOB_SHAPES.under, animationDelay: "-2s" }}
                />
                <span
                  className="animate-bob absolute -top-10 -right-8 size-24 bg-lemon shadow-sm md:size-28"
                  style={{ borderRadius: BLOB_SHAPES.over, animationDelay: "-4s" }}
                />
              </div>

              <div
                className="animate-pop relative space-y-3 rounded-3xl bg-card p-4 shadow-md"
                style={{ animationDelay: "80ms" }}
              >
                {/* Saturday's turn, on the peach date coin the rest of the
                    product uses wherever a date has to be a thing you look at
                    rather than read. */}
                <div
                  className="animate-rise flex items-center gap-3 rounded-2xl bg-muted p-3 shadow-xs"
                  style={{ animationDelay: "160ms" }}
                >
                  <span
                    className="animate-bob flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-peach text-plum shadow-xs"
                    style={{ animationDelay: "-1s" }}
                  >
                    <span className="text-[0.55rem] font-bold tracking-[0.18em] uppercase">
                      Jul
                    </span>
                    <span className="font-heading text-lg leading-none font-bold" data-numeric>
                      18
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="font-heading block truncate leading-snug font-semibold">
                      Kitchen deep clean
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      Sat 18 Jul
                      <span className="rounded-full bg-lemon px-2 py-0.5 text-[0.6875rem] font-semibold text-plum">
                        today
                      </span>
                    </span>
                  </span>
                </div>

                {/* The rest of the week, quiet on purpose. */}
                <ul
                  className="animate-rise divide-y divide-border px-1 text-sm text-muted-foreground"
                  style={{ animationDelay: "240ms" }}
                >
                  <li className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">Bins</span>
                    <span className="shrink-0 text-xs">Tue · Bass</span>
                  </li>
                  <li className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">Bathroom</span>
                    <span className="shrink-0 text-xs">Thu · Eliza</span>
                  </li>
                </ul>

                <div className="animate-rise space-y-1.5" style={{ animationDelay: "320ms" }}>
                  <p className="px-1 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    The text that goes out
                  </p>
                  <p className="rounded-3xl rounded-bl-md bg-secondary px-4 py-3 text-sm text-pretty text-secondary-foreground">
                    Hi Ciara 🌷 you&apos;re up for Kitchen deep clean this
                    Saturday. Can&apos;t make it? Tap to hand it on.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* The three moves, on white clay cards. */}
        <section className="grid gap-4 pt-12 pb-16 sm:grid-cols-3 md:pt-16 md:pb-24">
          {FEATURES.map(({ icon: Icon, coin, title, body }, index) => (
            <div
              key={title}
              className="animate-rise rounded-2xl bg-card p-6 shadow-sm"
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <span
                className={`grid size-11 place-items-center rounded-xl text-plum shadow-xs ${coin}`}
                aria-hidden
              >
                <Icon className="size-5" strokeWidth={2.25} />
              </span>
              <h2 className="font-heading mt-4 text-lg leading-snug font-semibold">
                {title}
              </h2>
              <p className="mt-2 text-sm text-pretty text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        {/* One last nudge, on the same lavender pane as the hero. No blobs here:
            they belong to the two heroes only, and a band this short has no
            corner they could sit in without landing on the copy. */}
        <section className="pb-16 md:pb-24">
          <div className="rounded-4xl bg-lavender-pane px-6 py-12 text-center shadow-sm md:py-16 dark:bg-card">
            <div className="mx-auto flex max-w-md flex-col items-center gap-5">
              <h2 className="font-heading text-2xl font-semibold text-balance md:text-3xl">
                Sort the rota tonight.
              </h2>
              <p className="text-sm text-pretty text-muted-foreground">
                One person sets it up. Everybody else just gets a friendly text
                when their turn comes round.
              </p>
              <Button asChild size="lg">
                <a href={SIGN_IN_HREF}>
                  Set up your house
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-8 md:px-8">
        <Wordmark muted />
        <p className="text-xs text-muted-foreground">Whose turn? Sorted.</p>
      </footer>
    </div>
  );
}
