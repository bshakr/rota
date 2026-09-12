import { ArrowRightLeft } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Shift } from "@/lib/api/types";
import {
  formatDayNumber,
  formatMonthShort,
  formatShiftDate,
  relativeDay,
} from "@/lib/date";
import { avatarTint } from "@/lib/avatar-tint";
import { civilDate } from "@/lib/group-dates";
import { capitalise, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A this-week shift carrying the rota it belongs to, so the glance names the job. */
export type WeekShift = Shift & { rotaName: string };

// The day's DATE COIN: the member page's page-a-day calendar leaf, reused as the
// day heading here so both surfaces speak the same language. 18px round, plum
// numerals, soft clay, and the pastel carries the urgency. Today wears peach
// (warm, the thing in front of you), tomorrow lemon (NOW, one sleep away), the
// rest of the week lilac (quiet). The coins are stickers, so they are
// theme-independent and their ink is always plum.
const COIN_STYLE = {
  today: "bg-peach text-plum",
  tomorrow: "bg-lemon text-plum",
  later: "bg-lilac text-plum",
} as const;

/**
 * "Who's up this week", the one-second read. Shifts arrive already filtered to the
 * group's week and sorted by day, then grouped under a date-coin day heading.
 * Each row leads with the job and the person responsible; a covered turn is set
 * apart at a glance by a sky badge and a sky wash, not by making the reader
 * parse the text. Day groups rise in one by one, the same staggered entrance
 * as the member page's shift list.
 */
export function WeekGlance({ shifts, today }: { shifts: WeekShift[]; today: string }) {
  const todayDate = civilDate(today);
  const days = groupByDay(shifts);

  return (
    <div className="space-y-7">
      {days.map(({ due_on, shifts }, index) => {
        const date = civilDate(due_on);
        const when = relativeDay(date, todayDate);
        const soon = when === "today" || when === "tomorrow";
        const coin =
          when === "today"
            ? COIN_STYLE.today
            : when === "tomorrow"
              ? COIN_STYLE.tomorrow
              : COIN_STYLE.later;

        return (
          <section
            key={due_on}
            className="animate-rise"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <h2 className="mb-3 flex items-center gap-3">
              <span
                className={cn(
                  "flex size-12 shrink-0 flex-col items-center justify-center rounded-xl shadow-xs",
                  coin,
                )}
                aria-hidden
              >
                <span className="text-[0.55rem] font-bold tracking-widest uppercase">
                  {formatMonthShort(date)}
                </span>
                <span className="font-heading text-lg leading-none font-bold" data-numeric>
                  {formatDayNumber(date)}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <span
                  className={cn(
                    "font-heading text-sm leading-none font-semibold",
                    soon ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {capitalise(when)}
                </span>
                <span className="text-muted-foreground text-xs leading-none tabular-nums">
                  {formatShiftDate(date)}
                </span>
              </span>
            </h2>

            <Card className="gap-0 py-0">
              <ul className="divide-border divide-y">
                {shifts.map((shift) => (
                  <li
                    key={shift.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-4 py-3.5 first:rounded-t-2xl last:rounded-b-2xl",
                      // The same quarter-strength sky wash the shifts board uses.
                      shift.covered && "bg-sky/25",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{shift.rotaName}</p>
                      {shift.covered ? (
                        <p className="text-muted-foreground truncate text-sm">
                          covering {shift.assigned_member.name}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                      {shift.covered ? (
                        <Badge variant="info">
                          <ArrowRightLeft aria-hidden />
                          Covered
                        </Badge>
                      ) : null}
                      <Avatar>
                        <AvatarFallback
                          className={cn(
                            avatarTint(shift.responsible_member.name),
                            "text-foreground text-xs font-semibold",
                          )}
                        >
                          {initials(shift.responsible_member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {shift.responsible_member.name}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

/** Collapse the pre-sorted list into consecutive day buckets, order preserved. */
function groupByDay(shifts: WeekShift[]): { due_on: string; shifts: WeekShift[] }[] {
  const days: { due_on: string; shifts: WeekShift[] }[] = [];
  for (const shift of shifts) {
    const last = days.at(-1);
    if (last && last.due_on === shift.due_on) last.shifts.push(shift);
    else days.push({ due_on: shift.due_on, shifts: [shift] });
  }
  return days;
}
