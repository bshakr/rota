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
 * shift card is the centre of the product, the thing someone reads after a
 * text, and in SOFT CLAY it reads like a page-a-day calendar someone actually
 * enjoys. A DATE COIN carries the day, the rota name speaks in Fredoka, and
 * "today" / "tomorrow" wears a lemon sticker.
 *
 * The coin IS a sticker, so it is painted in the theme-independent pastels
 * (`bg-peach text-plum`) rather than the semantic tokens: a peach coin with
 * plum numerals is a physical object, and it looks the same at night. Its
 * colour and its LIFT carry the state, so the card answers "what is this to
 * me?" before a word is read:
 *
 *   yours       peach, raised on clay: your turn, no cover arranged.
 *   covering    sky, raised on clay: you took someone else's turn, so "why am
 *               I down for the bins?" has an answer on the card itself.
 *   handed-off  quiet lilac, pressed flat: you gave this turn away, so the
 *               coin stops lifting off the card.
 *
 * Presentational only. `action` is the slot for the cover CTA.
 */
export type ShiftState =
  | { kind: "yours" }
  | { kind: "handed-off"; to: string }
  | { kind: "covering"; forName: string };

const COIN_STYLE: Record<ShiftState["kind"], string> = {
  yours: "bg-peach text-plum shadow-xs",
  covering: "bg-sky text-plum shadow-xs",
  "handed-off": "bg-lilac text-plum-muted",
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

  return (
    <Card className={className}>
      <div className="flex items-start gap-4 px-(--card-spacing)">
        {/* The date coin: 18px of clay, a tiny page-a-day calendar leaf. */}
        <span
          className={cn(
            "flex size-14 shrink-0 flex-col items-center justify-center rounded-xl",
            COIN_STYLE[state.kind],
          )}
          aria-hidden
        >
          <span className="text-[0.625rem] leading-none font-bold tracking-widest uppercase">
            {formatMonthShort(date)}
          </span>
          <span
            className="font-heading mt-1 text-xl leading-none font-bold"
            data-numeric
          >
            {formatDayNumber(date)}
          </span>
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="font-heading text-lg leading-snug font-semibold text-pretty">
            {rota}
          </h3>
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
        {state.kind === "covering" ? (
          // A name can be long and the phone is 390px wide, so this one badge
          // is allowed to wrap. Badge is a single-line chip by default and
          // there is no wrapping variant, so the override lives here.
          <Badge
            variant="info"
            className="h-auto max-w-full items-start py-1 text-left whitespace-normal"
          >
            <ArrowRightLeft className="mt-0.5" aria-hidden />
            You&apos;re covering for {state.forName}
          </Badge>
        ) : null}

        {state.kind === "handed-off" ? (
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">{state.to}</span> is
            covering this turn.
          </p>
        ) : null}

        {action ? <div>{action}</div> : null}
      </CardContent>
    </Card>
  );
}
