import { Construction } from "lucide-react";

/**
 * A screen that has a route and a nav entry but no content yet.
 *
 * BLO-1042 ships the shell and the design system only. Each of these names the
 * ticket that replaces it, so a downstream agent knows the file is theirs to
 * delete rather than something load-bearing to work around.
 *
 * It wears the card shape but a DASHED --input boundary and the quiet fill
 * instead of white, so nobody mistakes scaffolding for a finished panel.
 */
export function Placeholder({ ticket }: { ticket: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-input bg-muted/50 px-6 py-16 text-center text-muted-foreground">
      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-lemon text-plum shadow-xs">
        <Construction className="size-6" strokeWidth={2.25} aria-hidden />
      </span>
      <p className="text-sm">
        This screen ships in <span className="font-semibold">{ticket}</span>.
      </p>
      <p className="max-w-sm text-xs text-balance">
        BLO-1042 provides the shell, the tokens and the components. Replace this
        file.
      </p>
    </div>
  );
}
