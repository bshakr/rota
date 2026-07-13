import { ArrowRightLeft, CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * What a member sees for one upcoming turn. This is the vocabulary the member
 * page (BLO-1055) is assembled from, and the reason it lives in the design
 * system: the shift card is the centre of the product — the thing someone reads
 * after a text — and it has to feel like a note on the fridge, not a table row.
 *
 * Presentational only. `action` is the slot for the cover CTA (a Button that
 * opens the "ask someone to cover" flow); BLO-1055 wires the flow and passes it
 * in. The three states are the whole cover model as a member experiences it:
 *
 *   yours       your turn, no cover arranged — offer to hand it on.
 *   handed-off  you gave this turn to someone; they hold it now. You can take it
 *               back (the original assignee always can).
 *   covering    you took someone else's turn — shown so "why am I down for the
 *               bins?" has an answer on the card itself.
 */
export type ShiftState =
  | { kind: "yours" }
  | { kind: "handed-off"; to: string }
  | { kind: "covering"; forName: string };

export function ShiftCard({
  rota,
  date,
  today,
  state,
  action,
  className,
}: {
  rota: string;
  date: Date;
  today: Date;
  state: ShiftState;
  action?: React.ReactNode;
  className?: string;
}) {
  const when = relativeDay(date, today);
  const soon = when === "today" || when === "tomorrow";
  const handedOff = state.kind === "handed-off";

  return (
    <Card className={cn(handedOff && "opacity-70", className)}>
      <CardHeader>
        <CardTitle className="text-base">{rota}</CardTitle>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          <time>{formatShiftDate(date)}</time>
          <span aria-hidden>·</span>
          <span className={cn("font-medium", soon ? "text-primary" : "text-foreground")}>
            {when}
          </span>
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {state.kind === "covering" ? (
          <Badge variant="info">
            <ArrowRightLeft aria-hidden />
            You&apos;re covering for {state.forName}
          </Badge>
        ) : null}

        {state.kind === "handed-off" ? (
          <p className="text-sm">
            <span className="font-medium">{state.to}</span> is covering this turn.
          </p>
        ) : null}

        {action ? <div>{action}</div> : null}
      </CardContent>
    </Card>
  );
}
