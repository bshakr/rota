import { cn } from "@/lib/utils";

/**
 * The wordmark. Plain type, deliberately: Rota Monster has no mark yet, and a
 * placeholder glyph would be worse than none. `rota` is ink, `.monster` is the
 * action colour, both set in Fredoka at 700 and pressed a little wider
 * (`wdth` 110) than the heading default, with the letters pulled tight.
 *
 * The two colours are SEMANTIC rather than the plum/grape pastels, so the mark
 * survives dark mode: `rota` goes from plum ink to near-white, and `.monster`
 * lifts from grape to the night cut of grape. Lowercase always, matching the
 * URL: rota.monster.
 *
 * `muted` drops both colours to muted text. Used on the member page, where the
 * brand is a reassurance that the link is legitimate, not a logo to admire.
 */
export function Wordmark({
  className,
  muted = false,
}: {
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-heading text-lg leading-none font-bold tracking-[-0.03em] [font-variation-settings:'wdth'_110]",
        muted && "text-muted-foreground",
        className,
      )}
    >
      <span className={cn(!muted && "text-foreground")}>rota</span>
      <span className={cn(!muted && "text-link")}>.monster</span>
    </span>
  );
}
