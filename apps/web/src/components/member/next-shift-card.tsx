"use client";

import { ArrowRightLeft, CalendarCheck } from "lucide-react";

import { shiftStateFor } from "@/app/(member)/s/[token]/shift-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MemberShift } from "@/lib/api/types";
import { formatDayNumber, formatMonthShort, formatShiftDate, relativeDay } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

/**
 * What the member came for: the next turn they are actually on the hook for, with the
 * one action that matters on it. Up to two more are named in a single quiet line
 * underneath, because "and then?" is the second question and a second card would
 * compete with the feed.
 *
 * `shifts` is the viewer's own upcoming turns in order (schedule-view's
 * `responsibleShifts`). A shift they have handed away is NOT among them; it is in the
 * feed with its "Take it back".
 */
export function NextShiftCard({
  shifts,
  viewerId,
  today,
  onHandOff,
  className,
}: {
  shifts: MemberShift[];
  viewerId: number;
  /** The group's today as a civil date (YYYY-MM-DD). */
  today: string;
  onHandOff: (shift: MemberShift) => void;
  className?: string;
}) {
  const todayDate = civilDate(today);
  const [next, ...rest] = shifts;

  if (!next) {
    return (
      <Card className={cn("items-center gap-3 py-8 text-center", className)}>
        <CalendarCheck className="text-muted-foreground size-7" aria-hidden />
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">Nothing on your plate</h2>
          <p className="text-muted-foreground text-sm text-pretty">
            You are not down for anything right now. Here is what the rest of the house is up to.
          </p>
        </div>
      </Card>
    );
  }

  const date = civilDate(next.due_on);
  const when = relativeDay(date, todayDate);
  const soon = when === "today" || when === "tomorrow";
  const state = shiftStateFor(next, viewerId);

  return (
    <Card className={className}>
      <div className="flex items-start gap-4 px-(--card-spacing)">
        <span
          className="bg-peach text-plum flex size-14 shrink-0 flex-col items-center justify-center rounded-xl shadow-xs"
          aria-hidden
        >
          <span className="text-[0.625rem] leading-none font-bold tracking-widest uppercase">
            {formatMonthShort(date)}
          </span>
          <span className="font-heading mt-1 text-xl leading-none font-bold" data-numeric>
            {formatDayNumber(date)}
          </span>
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="font-heading text-lg leading-snug font-semibold text-pretty">
            {next.rota_name}
          </h2>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <time>{formatShiftDate(date)}</time>
            {soon ? (
              <Badge variant="warning">{when}</Badge>
            ) : (
              <span className="text-foreground font-medium">{when}</span>
            )}
          </p>
        </div>
      </div>

      <CardContent className="space-y-3 empty:hidden">
        {state?.kind === "covering" ? (
          // A name can be long and the phone is 390px wide, so this one badge wraps.
          <Badge
            variant="info"
            className="h-auto max-w-full items-start py-1 text-left whitespace-normal"
          >
            <ArrowRightLeft className="mt-0.5" aria-hidden />
            You are covering for {state.forName}
          </Badge>
        ) : null}

        {next.can_assign_cover ? (
          <Button size="lg" className="w-full" onClick={() => onHandOff(next)}>
            Hand off
          </Button>
        ) : null}

        {rest.length > 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Then{" "}
            {rest.slice(0, 2).map((shift, index) => (
              <span key={shift.id}>
                {index > 0 ? ", " : ""}
                <span className="text-foreground font-medium">{shift.rota_name}</span>{" "}
                {formatShiftDate(civilDate(shift.due_on))}
              </span>
            ))}
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
