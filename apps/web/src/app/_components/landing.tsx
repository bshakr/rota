import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  Calendar,
  Check,
  Link2,
  MessageSquareText,
  Plane,
  RefreshCw,
  Repeat,
  Smartphone,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Every lucide glyph shares one type, so naming a single icon is enough to type
 * the whole sheet. Saves importing `LucideIcon` just to describe a prop.
 */
type Glyph = typeof Repeat;

/**
 * The two halves of the pitch, each a panel of three lines. Every line wears its
 * own sticker from the pastel sheet: mint for the thing that quietly keeps
 * going, lemon for the text landing now, sky for a turn (or a housemate) on its
 * way somewhere else, peach for the one-off setup, lilac for the calendar. The
 * coins use the THEME-INDEPENDENT pastels paired with `text-plum`, because a
 * sticker is a physical object and does not invert at night.
 */
const ROTA_LINES = [
  {
    icon: Repeat,
    coin: "bg-mint",
    title: "Set it once",
    body: "Add each chore and say who takes turns. Bins on Tuesday, bathroom on Thursday, week after week.",
  },
  {
    icon: MessageSquareText,
    coin: "bg-lemon",
    title: "Texts, not nags",
    body: "Whoever is up gets a text with their own link. Nothing to install, nothing to sign up for.",
  },
  {
    icon: ArrowRightLeft,
    coin: "bg-sky",
    title: "Swaps sort themselves",
    body: "Busy this week? Hand your turn on in one tap. Everybody can see where it landed.",
  },
] as const;

const CALENDAR_LINES = [
  {
    icon: Link2,
    coin: "bg-peach",
    title: "Paste one link",
    body: "Drop in the house Google Calendar link, once. No Google sign-in, nothing else to connect.",
  },
  {
    icon: Calendar,
    coin: "bg-lilac",
    title: "Events in everyone’s feed",
    body: "House dinner, house meeting, birthdays. They show up next to the chores, for everybody.",
  },
  {
    icon: Plane,
    coin: "bg-sky",
    title: "Knows who’s away",
    body: "It reads “Ciara in France” the way a housemate would, and knows until when.",
  },
] as const;

/**
 * The reassurance strip: three quiet lines, no cards. These are the objections a
 * housemate raises before the person setting it up has finished the sentence.
 */
const REASSURANCES = [
  {
    icon: Smartphone,
    body: "Housemates get a text with their own link. Nothing to install, nothing to join.",
  },
  {
    icon: Link2,
    body: "You paste one calendar link, once. No Google sign-in, no apps to connect.",
  },
  {
    icon: RefreshCw,
    body: "The calendar refreshes itself every hour. Nothing else for you to do.",
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
 * lavender pane holding the pitch, pastel blobs bobbing behind it, and working
 * vignettes of the product's two ideas, which are whose turn it is and who is
 * actually home.
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
              globals.css stops them dead rather than speeding them up. Blobs
              live behind the hero and nowhere else. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <span
              className="animate-bob absolute -top-16 -right-16 size-32 bg-peach shadow-sm md:-top-20 md:-right-20 md:size-56"
              style={{ borderRadius: BLOB_SHAPES.corner }}
            />
          </div>

          <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
            <div className="animate-pop">
              <Badge
                variant="outline"
                className="mb-5 h-7 rounded-full border-border bg-card px-3.5 text-[0.8125rem] shadow-xs dark:bg-background"
              >
                Gently nags. Never bites.
              </Badge>
              {/* Three lines on purpose: two questions and the answer. The
                  breaks are real blocks rather than <br/>, so each line still
                  wraps on its own at 390px instead of overflowing. */}
              <h1 className="font-heading text-display font-semibold lg:text-6xl">
                <span className="block">Whose turn?</span>
                <span className="block">Who&rsquo;s home?</span>
                <span className="block">Sorted.</span>
              </h1>
              <p className="mt-5 max-w-md text-base text-pretty text-muted-foreground md:text-lg">
                Set the chores up once and Rota Monster texts whoever&rsquo;s up
                next. Paste the house calendar link and it knows who&rsquo;s
                away, so a turn never lands on somebody who&rsquo;s in France.
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

            {/* The vignette: one member feed with both halves of the product in
                it — a turn, a housemate away, a house event, and the quiet rest
                of the week. Illustrative fixed copy rather than live data, and
                hidden from assistive tech because it is a picture of the
                product, not a second copy of the pitch. */}
            <div className="relative mx-auto w-full max-w-sm lg:w-[22rem]" aria-hidden>
              <div className="pointer-events-none absolute inset-0">
                <span
                  className="animate-bob absolute -right-10 -bottom-12 size-28 bg-mint shadow-sm md:size-36"
                  style={{ borderRadius: BLOB_SHAPES.under, animationDelay: "-2s" }}
                />
                <span
                  className="animate-bob absolute -top-10 -left-8 size-24 bg-lemon shadow-sm md:size-28"
                  style={{ borderRadius: BLOB_SHAPES.over, animationDelay: "-4s" }}
                />
              </div>

              <div
                className="animate-pop relative space-y-3 rounded-3xl bg-card p-4 shadow-md"
                style={{ animationDelay: "80ms" }}
              >
                <div className="flex items-center justify-between px-1 pt-1">
                  <Eyebrow>Coming up</Eyebrow>
                  <span className="text-xs text-muted-foreground">Sat 20 Sep</span>
                </div>

                {/* Saturday's turn, on the peach date coin the rest of the
                    product uses wherever a date has to be a thing you look at
                    rather than read. */}
                <FeedRow
                  delay="160ms"
                  coin={
                    <Coin tint="bg-peach" className="animate-bob flex-col" delay="-1s">
                      <span className="text-[0.55rem] font-bold tracking-[0.18em] uppercase">
                        Sep
                      </span>
                      <span className="font-heading text-lg leading-none font-bold" data-numeric>
                        20
                      </span>
                    </Coin>
                  }
                  title="Kitchen deep clean"
                  meta={
                    <>
                      Sat 20 Sep
                      <span className="rounded-full bg-lemon px-2 py-0.5 text-[0.6875rem] font-semibold text-plum">
                        today
                      </span>
                    </>
                  }
                />

                {/* Who is not here, then what is happening here. The feed keeps
                    both in the same list as the chores, which is the point. */}
                <FeedRow
                  delay="240ms"
                  coin={
                    <Coin tint="bg-sky">
                      <Plane className="size-5" strokeWidth={2.25} />
                    </Coin>
                  }
                  title="Ciara away"
                  meta="until Sun 21 Sep"
                />

                <FeedRow
                  delay="320ms"
                  coin={
                    <Coin tint="bg-lilac">
                      <Calendar className="size-5" strokeWidth={2.25} />
                    </Coin>
                  }
                  title="House dinner"
                  meta="Thu 19:00"
                />

                {/* The rest of the week, quiet on purpose. */}
                <ul
                  className="animate-rise divide-y divide-border px-1 text-sm text-muted-foreground"
                  style={{ animationDelay: "400ms" }}
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
              </div>
            </div>
          </div>
        </section>

        {/* The pair. Two panels, deliberately different materials: the rota is
            white clay, the calendar is the same lavender pane as the hero, so
            they read as two halves rather than two features. */}
        <section className="pt-12 md:pt-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="font-heading text-2xl font-semibold text-balance md:text-4xl">
              Two things every house argues about.
            </h2>
            <p className="max-w-lg text-base text-pretty text-muted-foreground">
              Whose turn it is, and who is even here. Rota Monster keeps both, in
              one feed.
            </p>
          </div>

          <div className="mt-7 grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 md:gap-6">
            <div className="animate-rise flex flex-col gap-7 rounded-3xl bg-card p-6 shadow-sm md:p-10">
              <div className="flex flex-col gap-2.5">
                <Eyebrow>The rota</Eyebrow>
                <h3 className="font-heading text-2xl font-semibold md:text-3xl">
                  Whose turn.
                </h3>
              </div>

              <FeatureLines lines={ROTA_LINES} />

              {/* Vignette: the rota entry, and the text it sends. */}
              <div className="mt-auto space-y-3 rounded-2xl bg-muted p-4 shadow-xs" aria-hidden>
                <div className="flex items-center justify-between px-1">
                  <Eyebrow>In the rota</Eyebrow>
                  <span className="text-xs text-muted-foreground">Set up once</span>
                </div>

                <FeedRow
                  className="bg-card"
                  coin={
                    <Coin tint="bg-mint">
                      <Repeat className="size-5" strokeWidth={2.25} />
                    </Coin>
                  }
                  title="Kitchen deep clean"
                  meta="Every Saturday · Bass, Eliza, Raph, Ciara"
                />

                <Handover>the text that goes out when it&rsquo;s your turn</Handover>

                <p className="rounded-3xl rounded-bl-md bg-secondary px-4 py-3 text-sm text-pretty text-secondary-foreground">
                  Hi Ciara 🌷 you&rsquo;re up for Kitchen deep clean this
                  Saturday. Can&rsquo;t make it? Tap to hand it on.
                </p>
              </div>
            </div>

            <div
              className="animate-rise flex flex-col gap-7 rounded-3xl bg-lavender-pane p-6 shadow-sm md:p-10 dark:bg-card"
              style={{ animationDelay: "90ms" }}
            >
              <div className="flex flex-col gap-2.5">
                <Eyebrow>The calendar</Eyebrow>
                <h3 className="font-heading text-2xl font-semibold md:text-3xl">
                  Who&rsquo;s home.
                </h3>
              </div>

              <FeatureLines lines={CALENDAR_LINES} />

              {/* Vignette: a week of the house calendar, and the away row the
                  trip on it turns into. */}
              <div className="mt-auto space-y-3 rounded-2xl bg-card p-4 shadow-sm dark:bg-background" aria-hidden>
                <div className="flex items-center justify-between px-1">
                  <Eyebrow>In the house calendar</Eyebrow>
                  <span className="text-xs text-muted-foreground">September</span>
                </div>

                <div className="space-y-1 px-1">
                  <div className="grid grid-cols-5 gap-1 text-center text-[0.6875rem] font-semibold text-muted-foreground">
                    <span>Wed 17</span>
                    <span>Thu 18</span>
                    <span>Fri 19</span>
                    <span>Sat 20</span>
                    <span>Sun 21</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {/* The trip is a single bar across the week, the way it is
                        drawn in the calendar it came from. */}
                    <span className="col-span-5 flex h-6 items-center overflow-hidden rounded-lg bg-primary px-2.5 text-xs font-semibold whitespace-nowrap text-primary-foreground">
                      Ciara in France
                    </span>
                    <span className="col-span-3 col-start-2 flex h-6 items-center gap-1.5 px-1 text-xs font-medium whitespace-nowrap">
                      <span className="size-2 shrink-0 rounded-full bg-peach-deep" />
                      19:00 House dinner
                    </span>
                  </div>
                </div>

                <Handover>in everyone&rsquo;s feed, an hour later at most</Handover>

                <FeedRow
                  coin={
                    <Coin tint="bg-sky">
                      <Plane className="size-5" strokeWidth={2.25} />
                    </Coin>
                  }
                  title="Ciara away"
                  meta="until Sun 21 Sep"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Where the two halves meet, which is the only claim on this page that
            neither a rota app nor a calendar can make on its own. */}
        <section className="pt-6">
          <div className="animate-rise grid grid-cols-1 items-center gap-8 rounded-2xl bg-card p-6 shadow-sm md:p-12 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
            <div className="flex flex-col gap-3.5">
              <Eyebrow>They work together</Eyebrow>
              <h2 className="font-heading max-w-[18ch] text-2xl font-semibold text-balance md:text-3xl">
                Handing a turn on goes to someone who&rsquo;s actually home.
              </h2>
              <p className="max-w-md text-base text-pretty text-muted-foreground">
                When Raph hands Saturday&rsquo;s kitchen clean on, Ciara is shown
                as away and moved down the list. Eliza is first, because Eliza is
                in.
              </p>
            </div>

            {/* Vignette: the hand-off list, ranked the way the real sheet ranks
                it. The button is part of the picture, not an action, so it is a
                span wearing the button's clothes rather than a control inside an
                aria-hidden subtree. */}
            <div className="mx-auto w-full max-w-sm space-y-2.5 rounded-2xl bg-muted p-4 shadow-xs lg:max-w-none" aria-hidden>
              <div className="px-1 pb-1">
                <p className="font-heading text-base leading-snug font-semibold">
                  Hand Kitchen deep clean on
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sat 20 Sep, Raph&rsquo;s turn
                </p>
              </div>

              {/* The pick wears the inset grape ring a shift row wears when the
                  turn is yours, at shift-row.tsx's own ring-primary/40 and the
                  same width. An inset ring follows the row's corners and never
                  shifts its height. The fill stays white rather than borrowing
                  that row's lemon wash: these rows sit on the quiet fill rather
                  than on a card, so white is already what lifts them. */}
              <CandidateRow
                name="Eliza"
                detail="Home, and next in line"
                className="ring-2 ring-primary/40 ring-inset"
                trailing={
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                }
              />

              <CandidateRow
                name="Bass"
                detail="Home"
                trailing={<span className="size-5 shrink-0 rounded-full border-2 border-input" />}
              />

              {/* Away is not hidden and not disabled, only ranked down and
                  badged, which is what the hand-off sheet does with it. The
                  dimming is this vignette's own; the value is the one that
                  sheet dims an untextable housemate with. */}
              <CandidateRow
                name="Ciara"
                detail="In France, moved down for now"
                dimmed
                trailing={
                  <Badge variant="warning" className="shrink-0">
                    Away until Sun
                  </Badge>
                }
              />

              <span
                className={cn(buttonVariants({ size: "lg" }), "mt-1 w-full justify-center")}
              >
                Hand it to Eliza
              </span>
            </div>
          </div>
        </section>

        {/* Nothing to install. Three quiet lines with hairline rules, no cards:
            these are objections being closed, not features being sold. */}
        <section className="pt-10 md:pt-12">
          <div className="grid grid-cols-1 sm:grid-cols-3">
            {REASSURANCES.map(({ icon: Icon, body }, index) => (
              <p
                key={body}
                className={cn(
                  "flex items-start gap-3 py-4 text-sm text-pretty text-muted-foreground sm:py-0",
                  index === 0 && "pt-0 sm:pr-7",
                  index > 0 &&
                    "border-t border-border sm:border-t-0 sm:border-l sm:pl-7",
                  index === 1 && "sm:pr-7",
                  index === REASSURANCES.length - 1 && "pb-0",
                )}
              >
                <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={2.25} aria-hidden />
                {body}
              </p>
            ))}
          </div>
        </section>

        {/* One last nudge, on the same lavender pane as the hero. No blobs here:
            they belong to the hero only, and a band this short has no corner
            they could sit in without landing on the copy. */}
        <section className="pt-12 pb-16 md:pt-16 md:pb-24">
          <div className="rounded-4xl bg-lavender-pane px-6 py-12 text-center shadow-sm md:py-16 dark:bg-card">
            <div className="mx-auto flex max-w-md flex-col items-center gap-5">
              <h2 className="font-heading text-2xl font-semibold text-balance md:text-3xl">
                Sort the rota tonight.
              </h2>
              <p className="text-sm text-pretty text-muted-foreground">
                One person sets it up and pastes the house calendar link.
                Everybody else just gets a friendly text when their turn comes
                round.
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

/** The small caps label above a heading or on a vignette's header line. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/**
 * A pastel sticker holding an icon, a date, or anything else small enough to be
 * looked at rather than read. Fixed pastel plus `text-plum`: a sticker does not
 * invert at night.
 */
function Coin({
  tint,
  className,
  delay,
  children,
}: {
  tint: string;
  className?: string;
  delay?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-xl text-plum shadow-xs",
        tint,
        className,
      )}
      style={delay ? { animationDelay: delay } : undefined}
    >
      {children}
    </span>
  );
}

/** One line of a member feed: a coin, the thing, and when it is. */
function FeedRow({
  coin,
  title,
  meta,
  className,
  delay,
}: {
  coin: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  className?: string;
  delay?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-muted p-3 shadow-xs",
        delay && "animate-rise",
        className,
      )}
      style={delay ? { animationDelay: delay } : undefined}
    >
      {coin}
      <span className="min-w-0">
        <span className="font-heading block truncate leading-snug font-semibold">
          {title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
    </div>
  );
}

/** The "and then this happens" arrow between the two halves of a vignette. */
function Handover({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-pretty text-muted-foreground">
      <ArrowDown className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      {children}
    </p>
  );
}

/** The three lines inside one of the pair panels. */
function FeatureLines({
  lines,
}: {
  lines: readonly { readonly icon: Glyph; readonly coin: string; readonly title: string; readonly body: string }[];
}) {
  return (
    <ul className="flex flex-col gap-4.5">
      {lines.map(({ icon: Icon, coin, title, body }) => (
        <li key={title} className="flex items-start gap-3.5">
          <span
            className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-plum shadow-xs", coin)}
            aria-hidden
          >
            <Icon className="size-5" strokeWidth={2.25} />
          </span>
          <span>
            <span className="font-heading block text-base leading-snug font-semibold">
              {title}
            </span>
            <span className="mt-1 block text-sm text-pretty text-muted-foreground">
              {body}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One housemate in the hand-off vignette, built the way the real hand-off sheet
 * builds them: the avatar's tint comes from `avatarTint(name)`, so the Eliza
 * here is the same mint as the Eliza in the product.
 */
function CandidateRow({
  name,
  detail,
  trailing,
  className,
  dimmed = false,
}: {
  name: string;
  detail: string;
  trailing: React.ReactNode;
  className?: string;
  dimmed?: boolean;
}) {
  // Dimming covers the person, not the trailing badge: a lemon pill at 60%
  // over the night panel drops under AA, and the badge is the one thing in a
  // dimmed row the reader has to be able to read.
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl bg-card p-3 shadow-xs", className)}>
      {/* The real Avatar is a client component, and three decorative initials
          are not worth shipping one to a static marketing page. Same tint, same
          geometry, no JavaScript. */}
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-foreground shadow-xs",
          avatarTint(name),
          dimmed && "opacity-60",
        )}
      >
        {initials(name)}
      </span>
      <span className={cn("min-w-0 flex-1", dimmed && "opacity-60")}>
        {/* The name keeps `text-foreground` even when dimmed: opacity is the
            whole step-back, as in the hand-off sheet. Muting the colour as well
            would double-dim it below 3:1 on paper. */}
        <span className="font-heading block truncate text-sm leading-snug font-semibold">
          {name}
        </span>
        <span className="mt-0.5 block text-xs text-pretty text-muted-foreground">{detail}</span>
      </span>
      {trailing}
    </div>
  );
}
