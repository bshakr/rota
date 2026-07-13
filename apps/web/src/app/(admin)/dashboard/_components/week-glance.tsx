import { ArrowRightLeft } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Shift } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A this-week shift carrying the rota it belongs to, so the glance names the job. */
export type WeekShift = Shift & { rotaName: string };

/**
 * "Who's up this week", the one-second read. Shifts arrive already filtered to the
 * group's week and sorted by day, then grouped under a day heading. Each row leads
 * with the job and the person responsible; a covered turn is set apart at a glance
 * by an info badge and a tint, not by making the reader parse the text.
 */
export function WeekGlance({ shifts, today }: { shifts: WeekShift[]; today: string }) {
  const todayDate = civilDate(today);
  const days = groupByDay(shifts);

  return (
    <div className="space-y-6">
      {days.map(({ due_on, shifts }) => {
        const date = civilDate(due_on);
        const when = relativeDay(date, todayDate);
        const soon = when === "today" || when === "tomorrow";

        return (
          <section key={due_on}>
            <h2 className="mb-2 flex items-baseline gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  soon ? "text-primary" : "text-foreground",
                )}
              >
                {capitalise(when)}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatShiftDate(date)}
              </span>
            </h2>

            <Card className="gap-0 py-0">
              <ul className="divide-y divide-border">
                {shifts.map((shift) => (
                  <li
                    key={shift.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-4 py-3",
                      shift.covered && "bg-info/5",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{shift.rotaName}</p>
                      {shift.covered ? (
                        <p className="truncate text-sm text-muted-foreground">
                          covering {shift.assigned_member.name}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {shift.covered ? (
                        <Badge variant="info">
                          <ArrowRightLeft aria-hidden />
                          Covered
                        </Badge>
                      ) : null}
                      <Avatar size="sm">
                        <AvatarFallback>
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

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
