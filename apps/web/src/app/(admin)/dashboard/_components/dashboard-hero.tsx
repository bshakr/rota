import { ArrowRightLeft, CalendarDays, Sun, Users } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The dashboard's opening move: the group's name in Fraunces on a sunrise
 * band, with the week's real numbers as solid stat chips. Nothing here is
 * invented — every count is computed by the page from the same data the rest
 * of the screen renders — so even a quiet week gets the warm treatment
 * without the page pretending anything is happening.
 *
 * The chip hues follow the choir: sunshine = NOW (today's turns), iris = the
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
      className="animate-pop relative mb-8 overflow-hidden rounded-2xl bg-[image:var(--gradient-sunrise)] p-6 shadow-sm md:p-8"
    >
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

      <ul className="mt-6 flex flex-wrap gap-2.5">
        {stats.map(({ label, value, icon: Icon, iconClass }) => (
          <li
            key={label}
            className="flex items-center gap-2.5 rounded-lg bg-card px-3.5 py-2 shadow-xs"
          >
            <Icon className={cn("size-4 shrink-0", iconClass)} aria-hidden />
            <span className="font-heading text-lg leading-none font-semibold" data-numeric>
              {value}
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
