import { ArrowRightLeft, CalendarDays, Sun, Users } from "lucide-react";

import { LedgerTile, type LedgerCoin } from "@/components/ledger-tile";
import { cn } from "@/lib/utils";

// The blobs behind the hero. Organic rather than circular, each with its own
// lopsided radius so no two read as the same shape, drifting on the slow 6s bob
// (translate only, stilled outright under prefers-reduced-motion by globals.css).
// Decorative. `bg-blob-*` is the one theme-aware pastel: the sticker by day
// and its -700 night cut after dark, because the hero's words sit on top of
// these and `text-foreground` goes white at night. The pane itself becomes a
// plum panel (dark:bg-card), matching the landing hero.
const BLOBS = [
  {
    tint: "bg-blob-peach",
    radius: "58% 42% 45% 55% / 55% 48% 52% 45%",
    position: "-top-16 -left-10 size-48 md:size-56",
    delay: "0s",
  },
  {
    tint: "bg-blob-lemon",
    radius: "42% 58% 62% 38% / 47% 56% 44% 53%",
    position: "-right-12 -bottom-20 size-52 md:size-64",
    delay: "-2s",
  },
  {
    tint: "bg-blob-sky",
    radius: "50% 50% 38% 62% / 60% 40% 60% 40%",
    position: "top-1/3 right-1/3 hidden size-32 lg:block",
    delay: "-4s",
  },
] as const;

/**
 * The dashboard's opening move: a CLAY BAND on the lavender pane, 32px round,
 * with pastel blobs bobbing behind it. Words sit on the left, and the week's
 * real numbers sit on the right as a 2x2 ledger of paper tiles, each carrying
 * the pastel that means what it counts.
 *
 * Nothing here is invented. Every count is computed by the page from the same
 * data the rest of the screen renders, so even a quiet week gets the warm
 * treatment without the page pretending anything is happening.
 *
 * The tile hues follow the sticker sheet: lemon = NOW (today's turns), lilac =
 * the week ahead, sky = covered (a turn on its way to someone else). Housemates
 * wears peach, warmth rather than status.
 *
 * The tile itself is `<LedgerTile>`, shared with HQ's overview — same geometry,
 * same coin, same numeral. What is local to the hero is the SURFACE: these sit
 * on the lavender pane, so they wear lavender paper rather than the card white a
 * tile takes on the ordinary page.
 */
export function DashboardHero({
  groupName,
  todayCount,
  weekCount,
  coveredCount,
  memberCount,
}: {
  groupName: string;
  todayCount: number;
  weekCount: number;
  coveredCount: number;
  memberCount: number;
}) {
  const stats: { label: string; value: number; icon: typeof Sun; coin: LedgerCoin }[] = [
    {
      label: todayCount === 1 ? "turn today" : "turns today",
      value: todayCount,
      icon: Sun,
      coin: "lemon",
    },
    { label: "this week", value: weekCount, icon: CalendarDays, coin: "lilac" },
    { label: "covered", value: coveredCount, icon: ArrowRightLeft, coin: "sky" },
    {
      label: memberCount === 1 ? "housemate" : "housemates",
      value: memberCount,
      icon: Users,
      coin: "peach",
    },
  ];

  return (
    <section
      aria-labelledby="dashboard-title"
      className="animate-pop bg-lavender-pane relative mb-8 overflow-hidden rounded-4xl p-6 shadow-sm md:p-9 dark:bg-card"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {BLOBS.map((blob) => (
          <span
            key={blob.position}
            className={cn("animate-bob absolute shadow-xs", blob.tint, blob.position)}
            style={{ borderRadius: blob.radius, animationDelay: blob.delay }}
          />
        ))}
      </div>

      <div className="relative grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Dashboard
          </p>
          <h1
            id="dashboard-title"
            className="font-heading text-foreground mt-1.5 text-3xl font-semibold break-words text-balance md:text-4xl"
          >
            {groupName}
          </h1>
          <p className="text-foreground mt-2 max-w-prose text-sm md:text-base">
            Who&apos;s up this week, across every rota. Rota Monster texts whoever&apos;s up.
          </p>
        </div>

        <ul className="grid shrink-0 grid-cols-2 gap-3">
          {stats.map((stat) => (
            <LedgerTile
              key={stat.label}
              {...stat}
              className="bg-lavender dark:bg-background"
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
