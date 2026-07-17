import { ArrowRightLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatDayNumber,
  formatMonthShort,
  formatShiftDate,
  relativeDay,
} from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * What a member sees for one upcoming turn. This is the vocabulary the member
 * page is assembled from, and the reason it lives in the design system: the
 * shift card is the centre of the product — the thing someone reads after a
 * text — and in SOLSTICE it reads like a page-a-day calendar someone actually
 * enjoys: a DATE COIN carries the day, the rota name speaks in Fraunces, and
 * "today"/"tomorrow" wears a little sunshine badge.
 *
 * The coin's colour carries the state, so the card answers "what is this to
 * me?" before a word is read:
 *
 *   yours       sunrise gradient — your turn, no cover arranged.
 *   handed-off  muted — you gave this turn to someone; they hold it now.
 *   covering    sky tint — you took someone else's turn, so "why am I down
 *               for the bins?" has an answer on the card itself.
 *
 * Presentational only. `action` is the slot for the cover CTA.
 */
export type ShiftState =
  | { kind: "yours" }
  | { kind: "handed-off"; to: string }
  | { kind: "covering"; forName: string };

const COIN_STYLE: Record<ShiftState["kind"], string> = {
  yours: "bg-[image:var(--gradient-sunrise)] text-foreground shadow-sm",
  "handed-off": "bg-muted text-muted-foreground",
  covering: "bg-info/10 text-info dark:bg-info/20",
};

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
    <Card className={cn(handedOff && "opacity-75", className)}>
      <div className="flex items-start gap-4 px-(--card-spacing)">
        {/* The date coin. A tiny page-a-day calendar leaf. */}
        <span
          className={cn(
            "flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl",
            COIN_STYLE[state.kind],
          )}
          aria-hidden
        >
          <span className="text-[0.625rem] font-bold tracking-widest uppercase">
            {formatMonthShort(date)}
          </span>
          <span className="font-heading text-xl leading-none font-bold" data-numeric>
            {formatDayNumber(date)}
          </span>
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-heading text-lg leading-snug font-semibold">{rota}</h3>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            <time>{formatShiftDate(date)}</time>
            <span aria-hidden>·</span>
            {soon ? (
              <Badge variant="warning">{when}</Badge>
            ) : (
              <span className="font-medium text-foreground">{when}</span>
            )}
          </p>
        </div>
      </div>

      <CardContent className="space-y-3 empty:hidden">
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
