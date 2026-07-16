import { House } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The mark. A house on a sunrise-gradient tile, wordmark set in Fraunces —
 * the display voice — so the brand smiles the way the greetings do.
 *
 * `muted` drops the gradient and quiets the text: used on the member page,
 * where the brand is a reassurance that the link is legitimate, not a logo to
 * admire.
 */
export function Wordmark({
  className,
  muted = false,
}: {
  className?: string;
  muted?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-xl",
          muted
            ? "bg-muted text-muted-foreground"
            : "bg-[image:var(--gradient-sunrise)] text-foreground shadow-xs",
        )}
      >
        <House className="size-[18px]" strokeWidth={2.25} aria-hidden />
      </span>
      <span
        className={cn(
          "font-heading text-lg font-semibold tracking-tight",
          muted && "text-muted-foreground",
        )}
      >
        HouseRota
      </span>
    </span>
  );
}
