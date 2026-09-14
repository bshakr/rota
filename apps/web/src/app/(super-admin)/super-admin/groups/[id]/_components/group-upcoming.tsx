import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpcomingShift } from "@/lib/api/super-admin-groups";
import {
  GROUP_SECTION,
  turnHolder,
  turnRotaState,
  turnSilenceNote,
  upcomingDays,
  upcomingWindowNote,
} from "@/lib/hq-group-report";

import { Empty } from "./group-admins";

/**
 * The next fortnight of turns, in this house's own days.
 *
 * THE WINDOW IS THE HOUSE'S, not the server's. Rails builds it from the group's
 * midnight (`GroupReport::UPCOMING_DAYS` days from `now.in_time_zone(group)`),
 * and `today` arrives here the same way — `groupToday(now, group.timezone)` — so
 * a house in Auckland is not told its Tuesday turn is "tomorrow" because London
 * has not got there yet. Every `due_on` is a civil date with no instant behind
 * it, so the grouping itself is string equality and nothing here can drift.
 *
 * TWO THINGS ARE MARKED, and they are the two questions this card exists to
 * answer:
 *
 *   - WHO COVERS FOR WHOM. A cover is the product's one genuine engagement
 *     signal. Printing only whoever ends up doing the job would erase it from the
 *     one screen built to see it, so a covered turn names both people.
 *   - WHICH TURNS ARE SILENT. A turn on a paused or draft rota is a real row with
 *     a real person's name on it that nobody will be told about, and an operator
 *     answering "why did nobody hear about Thursday" has to read that off the row
 *     rather than by cross-referencing the rotas card. Marked, never filtered
 *     out: hiding the turn would answer the question by deleting it.
 *
 * Days with nothing due are not drawn. Fourteen rows of which three carry a turn
 * is eleven rows of nothing, and on a phone that is most of a screen; the
 * description says how wide the window is instead.
 */
export function GroupUpcoming({
  shifts,
  today,
  windowDays,
  suspended,
}: {
  shifts: UpcomingShift[];
  /** The house's own today, as a civil date. See `groupToday`. */
  today: string;
  /** How many days Rails looked ahead — said in words rather than assumed to be 14. */
  windowDays: number;
  suspended: boolean;
}) {
  const days = upcomingDays(shifts, today);

  return (
    <Card id={GROUP_SECTION.upcoming} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Coming up</CardTitle>
        <CardDescription>{upcomingWindowNote(windowDays, shifts.length)}</CardDescription>
      </CardHeader>

      <CardContent>
        {days.length === 0 ? (
          <Empty>No turns are due in this window.</Empty>
        ) : (
          <ol className="divide-border divide-y">
            {days.map((day) => (
              <li key={day.due_on} className="py-3 first:pt-0 last:pb-0">
                <p className="font-heading flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                  <time dateTime={day.due_on}>{day.date}</time>
                  {day.soon ? (
                    <span className="text-muted-foreground text-xs font-normal">{day.soon}</span>
                  ) : null}
                </p>

                <ul className="mt-1.5 space-y-1.5">
                  {day.shifts.map((shift) => (
                    <Turn key={shift.id} shift={shift} suspended={suspended} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function Turn({ shift, suspended }: { shift: UpcomingShift; suspended: boolean }) {
  const holder = turnHolder(shift);
  const state = turnRotaState(shift, { suspended });
  const silence = turnSilenceNote(shift, { suspended });

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm break-words">
          <span className="text-muted-foreground">{shift.rota_name}</span>
          {" · "}
          <span className="font-medium">{holder.name}</span>
          {holder.covering ? (
            // The handover, in the same sentence as the name and not as a badge:
            // "Bob, covering for Alice" is one fact about one turn, and splitting
            // it across two elements makes the reader assemble it.
            <span className="text-muted-foreground">, {holder.covering}</span>
          ) : null}
        </p>
        {silence ? (
          <p className="text-muted-foreground text-xs text-pretty">{silence}</p>
        ) : null}
      </div>

      {/* Only when something is off. A "Running" pill on every ordinary turn is
          fourteen pills saying nothing, and the two that matter stop standing out. */}
      {silence ? (
        <Badge variant={state.tone} className="shrink-0">
          {state.label}
        </Badge>
      ) : null}
    </li>
  );
}
