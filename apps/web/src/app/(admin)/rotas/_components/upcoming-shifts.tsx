"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Shift } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { initials } from "@/lib/format";

import { dayStringToDisplayDate } from "../rota-logic";

const PREVIEW_COUNT = 6;

/**
 * The AUTHORITATIVE upcoming shifts — the rows Rails actually generated, from
 * `listShifts`. Shown once the roster is saved, replacing the transient
 * client-side projection. Being real data it can show what a projection can't:
 * a cover in effect (responsible ≠ assigned). Rails is the source of truth for
 * what is scheduled; the projection is only a hint while editing.
 */
export function UpcomingShifts({ shifts, todayDay }: { shifts: Shift[]; todayDay: string }) {
  const upcoming = shifts
    .filter((shift) => shift.due_on >= todayDay)
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
    .slice(0, PREVIEW_COUNT);

  if (upcoming.length === 0) {
    return <p className="text-sm text-muted-foreground">No upcoming shifts scheduled.</p>;
  }

  const today = dayStringToDisplayDate(todayDay);

  return (
    <ol className="space-y-2">
      {upcoming.map((shift) => {
        const date = dayStringToDisplayDate(shift.due_on);
        return (
          <li key={shift.id} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 font-medium tabular-nums">
              {formatShiftDate(date)}
            </span>
            <Avatar className="size-6">
              <AvatarFallback className="text-[10px]">
                {initials(shift.responsible_member.name)}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{shift.responsible_member.name}</span>
              {shift.covered ? (
                <Badge variant="secondary">covering {shift.assigned_member.name}</Badge>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeDay(date, today)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
