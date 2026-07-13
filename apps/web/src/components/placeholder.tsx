import { Construction } from "lucide-react";

/**
 * A screen that has a route and a nav entry but no content yet.
 *
 * BLO-1042 ships the shell and the design system only. Each of these names the
 * ticket that replaces it, so a downstream agent knows the file is theirs to
 * delete rather than something load-bearing to work around.
 */
export function Placeholder({ ticket }: { ticket: string }) {
  return (
    <div className="border-border text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <Construction className="size-6" aria-hidden />
      <p className="text-sm">
        This screen ships in <span className="font-medium">{ticket}</span>.
      </p>
      <p className="max-w-sm text-xs text-balance">
        BLO-1042 provides the shell, the tokens and the components. Replace this
        file.
      </p>
    </div>
  );
}
