import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A LEDGER TILE: a pastel coin, one big Fredoka numeral, a quiet label under it.
 *
 * The house dashboard's hero invented this object — the 2x2 ledger of paper
 * tiles on the lavender pane — and HQ's overview needs exactly the same one for
 * its KPI row. So it lives here rather than in either screen: two copies of a
 * tile is how two screens start disagreeing about what a number looks like.
 *
 * The coin's hue MEANS something and the caller picks it from the sticker sheet
 * (lemon = now, lilac = the week ahead, sky = on its way, mint = done, blush =
 * went wrong, peach = warmth). Coins are stickers: they keep their pastel at
 * night, which is why the glyph on them is pinned to `text-plum` rather than
 * following the theme.
 *
 * The surface defaults to a card, because that is what a tile sitting on the
 * ordinary page needs. The hero passes its own — it sits on a lavender pane, and
 * a card-white tile there would be a hole rather than a tile.
 *
 * Renders an `<li>`: every use of it is a list of counts, and a list of counts
 * that is not a list is a screen reader hearing eight unrelated numbers.
 */
export type LedgerCoin = "lemon" | "lilac" | "sky" | "peach" | "mint" | "blush";

const COIN_TINT: Record<LedgerCoin, string> = {
  lemon: "bg-lemon",
  lilac: "bg-lilac",
  sky: "bg-sky",
  peach: "bg-peach",
  mint: "bg-mint",
  blush: "bg-blush",
};

/**
 * How the second line reads. `quiet` is the ordinary muted footnote; `alert` is
 * the semantic "went wrong" ink, for a note that is itself the bad news (a
 * delivery rate with failures behind it). Never the accent — the accent is the
 * hover tint, and a tile that looks hovered is not a tile that looks wrong.
 */
export type LedgerNoteTone = "quiet" | "alert";

const NOTE_TONE: Record<LedgerNoteTone, string> = {
  quiet: "text-muted-foreground",
  alert: "text-destructive font-medium",
};

export function LedgerTile({
  label,
  value,
  icon: Icon,
  coin,
  note,
  noteTone = "quiet",
  className,
}: {
  /** The quiet line under the numeral: "turns today", "houses". */
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  coin: LedgerCoin;
  /** An optional third line — a denominator, a share, a comparison. */
  note?: string;
  noteTone?: LedgerNoteTone;
  className?: string;
}) {
  return (
    <li className={cn("bg-card min-w-32 rounded-2xl px-4 py-3.5 shadow-xs", className)}>
      <span className="flex items-center gap-2.5">
        <span
          className={cn("grid size-7 shrink-0 place-items-center rounded-full", COIN_TINT[coin])}
          aria-hidden
        >
          <Icon className="text-plum size-3.5" strokeWidth={2.5} />
        </span>
        <span
          className="font-heading text-foreground text-2xl leading-none font-semibold"
          data-numeric
        >
          {value}
        </span>
      </span>
      <span className="text-muted-foreground mt-1.5 block text-xs">{label}</span>
      {note ? <span className={cn("mt-1 block text-xs", NOTE_TONE[noteTone])}>{note}</span> : null}
    </li>
  );
}
