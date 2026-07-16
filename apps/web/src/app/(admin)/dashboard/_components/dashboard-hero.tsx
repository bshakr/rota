import { ArrowRightLeft, CalendarDays, Sun, Users } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The dashboard's opening move — a FROSTED GLASS pane: candy-bright sunrise
 * blobs drift behind a translucent, blurred panel, so the hero reads as a
 * pane you look through rather than a printed band. Words sit on the left;
 * the week's real numbers sit on the right as a 2×2 ledger of frosted tiles,
 * with real typographic weight instead of riding in pills.
 *
 * Nothing here is invented — every count is computed by the page from the
 * same data the rest of the screen renders — so even a quiet week gets the
 * warm treatment without the page pretending anything is happening.
 *
 * The tile hues follow the choir: sunshine = NOW (today's turns), iris = the
 * week ahead (the thing to act on), sky = covered (a turn on its way to
 * someone else). Housemates stays quiet — it is not a status.
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
  const stats = [
    { label: todayCount === 1 ? "turn today" : "turns today", value: todayCount, icon: Sun, iconClass: "text-warning" },
    { label: "this week", value: weekCount, icon: CalendarDays, iconClass: "text-primary" },
    { label: "covered", value: coveredCount, icon: ArrowRightLeft, iconClass: "text-info" },
    { label: memberCount === 1 ? "housemate" : "housemates", value: memberCount, icon: Users, iconClass: "text-muted-foreground" },
  ];

  return (
    <section
      aria-labelledby="dashboard-title"
      className="animate-pop relative mb-8 overflow-hidden rounded-3xl border border-border/60 p-2 shadow-sm"
    >
      {/* The weather behind the glass. Decorative only — every text token sits
          on the blurred translucent pane below, never directly on a blob. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-24 -left-16 size-80 rounded-full bg-[image:var(--gradient-sunrise)] opacity-90 blur-2xl" />
        <div className="absolute -right-12 -bottom-24 size-72 rotate-180 rounded-full bg-[image:var(--gradient-sunrise)] opacity-80 blur-2xl" />
        <div className="absolute -bottom-20 left-1/4 size-64 rounded-full bg-primary/50 blur-3xl" />
      </div>

      <div className="relative rounded-2xl border border-border/50 bg-card/55 p-5 shadow-md backdrop-blur-xl md:p-7">
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase">Dashboard</p>
            <h1
              id="dashboard-title"
              className="font-heading mt-1.5 text-3xl font-semibold break-words text-balance md:text-4xl"
            >
              {groupName}
            </h1>
            <p className="mt-2 max-w-prose text-sm md:text-base">
              Who&apos;s up this week, across every rota.
            </p>
          </div>

          <ul className="grid shrink-0 grid-cols-2 gap-2.5">
            {stats.map(({ label, value, icon: Icon, iconClass }) => (
              <li
                key={label}
                className="min-w-28 rounded-xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-md"
              >
                <span className="flex items-center gap-2">
                  <span className="font-heading text-2xl leading-none font-semibold" data-numeric>
                    {value}
                  </span>
                  <Icon className={cn("size-4 shrink-0", iconClass)} aria-hidden />
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
