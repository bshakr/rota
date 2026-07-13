"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { IntervalUnit, RotaPositionEntry } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { initials } from "@/lib/format";

import { dayStringToDisplayDate, projectShifts } from "../rota-logic";

const PREVIEW_COUNT = 6;

/**
 * Who lands where, computed from the current schedule and the roster order the
 * admin is editing — BEFORE anything is saved. It mirrors the Rails generator's
 * date math (see rota-logic), so dragging a name updates this list to exactly what
 * the backend will generate on save.
 */
export function ShiftProjection({
  startsOn,
  intervalCount,
  intervalUnit,
  roster,
  todayDay,
}: {
  startsOn: string;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  roster: RotaPositionEntry[];
  todayDay: string;
}) {
  const shifts = projectShifts({
    startsOn,
    intervalCount,
    intervalUnit,
    roster,
    count: PREVIEW_COUNT,
    fromDay: todayDay,
  });

  if (shifts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add someone to the roster to see the upcoming shifts.
      </p>
    );
  }

  const today = dayStringToDisplayDate(todayDay);

  return (
    <ol className="space-y-2">
      {shifts.map((shift) => {
        const date = dayStringToDisplayDate(shift.dueOn);
        return (
          <li key={shift.dueOn} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 font-medium tabular-nums">
              {formatShiftDate(date)}
            </span>
            <Avatar className="size-6">
              <AvatarFallback className="text-[10px]">
                {initials(shift.member.name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate">{shift.member.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeDay(date, today)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
