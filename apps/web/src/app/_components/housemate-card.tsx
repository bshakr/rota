import { Smartphone } from "lucide-react";

/**
 * The page talks to the person setting the house up, because they are the only
 * one who ever visits it. This is the one card that answers the question they
 * get asked back: what is this going to make everybody else do?
 *
 * On the lavender pane rather than white clay, so it reads as an aside to the
 * hand-off card above it rather than a second feature panel.
 */
export function HousemateCard() {
  return (
    // 40px of clear space, matching the gap between the questions card and the
    // closing panel. Anything tighter and two stacked cards read as one card
    // with a footnote rather than two beats.
    <section className="pt-10">
      <div className="flex flex-col items-start gap-4 rounded-2xl bg-lavender-pane p-6 shadow-sm sm:flex-row sm:gap-5 md:p-8 dark:bg-card">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-lemon text-plum shadow-xs"
          aria-hidden
        >
          <Smartphone className="size-5" strokeWidth={2.25} />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="font-heading text-xl font-semibold md:text-2xl">
            What a housemate gets
          </h2>
          <p className="max-w-xl text-base text-pretty text-muted-foreground">
            No app. A text when it&rsquo;s your turn, with a link to your own page: your
            next turns, who&rsquo;s away, what&rsquo;s on in the house. Nothing to
            download, no password to forget.
          </p>
        </div>
      </div>
    </section>
  );
}
