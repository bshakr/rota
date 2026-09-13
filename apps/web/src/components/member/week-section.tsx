"use client";

import type { WeekSection as WeekSectionModel } from "@/app/(member)/s/[token]/schedule-view";
import { EventRow } from "@/components/member/event-row";
import { ShiftRow } from "@/components/member/shift-row";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { MemberShift } from "@/lib/api/types";
import { formatDayNumber, formatMonthShort, formatShiftDate, relativeDay } from "@/lib/date";
import { capitalise } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

// A DATE COIN per day, the same page-a-day calendar leaf the dashboard's week glance
// uses, so the two surfaces speak one language. Today wears peach (the thing in front
// of you), tomorrow lemon (one sleep away), the rest lilac (quiet). The coins are
// stickers: theme-independent, and their ink is always plum.
const COIN_STYLE = {
  today: "bg-peach text-plum",
  tomorrow: "bg-lemon text-plum",
  later: "bg-lilac text-plum",
} as const;

/** One week of the feed: its label, then a card per day. */
export function WeekSection({
  week,
  today,
  viewerId,
  onHandOff,
  onTakeBack,
}: {
  week: WeekSectionModel;
  /** The group's today as a civil date; the reference every relative day is measured from. */
  today: string;
  viewerId: number;
  onHandOff: (shift: MemberShift) => void;
  onTakeBack: (shift: MemberShift) => void;
}) {
  const todayDate = civilDate(today);

  return (
    <section>
      <h2 className="font-heading text-muted-foreground mb-3 text-sm font-semibold">
        {week.label}
      </h2>

      <div className="space-y-4">
        {week.days.map((day) => {
          const date = civilDate(day.due_on);
          const when = relativeDay(date, todayDate);
          const coin =
            when === "today"
              ? COIN_STYLE.today
              : when === "tomorrow"
                ? COIN_STYLE.tomorrow
                : COIN_STYLE.later;

          return (
            <div key={day.due_on}>
              <h3 className="mb-2 flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-11 shrink-0 flex-col items-center justify-center rounded-xl shadow-xs",
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
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{formatShiftDate(date)}</span>
                  {when === "today" ? (
                    <Badge variant="warning">Today</Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">{capitalise(when)}</span>
                  )}
                </span>
              </h3>

              <Card className="gap-0 overflow-hidden py-0">
                <ul className="divide-border divide-y">
                  {day.shifts.map((shift) => (
                    <ShiftRow
                      key={shift.id}
                      shift={shift}
                      viewerId={viewerId}
                      onHandOff={onHandOff}
                      onTakeBack={onTakeBack}
                    />
                  ))}
                  {/* House calendar entries come AFTER the day's turns, in the same
                      list, because they are context for those turns rather than
                      competition for them. A day can carry only these. */}
                  {day.events.map((event) => (
                    <EventRow key={`event-${event.id}`} event={event} />
                  ))}
                </ul>
              </Card>
            </div>
          );
        })}
      </div>
    </section>
  );
}
