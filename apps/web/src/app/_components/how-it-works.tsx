import { cn } from "@/lib/utils";

/**
 * The three steps, in the order somebody actually does them. Numbered coins
 * rather than icons: this is the one section on the page that is a sequence, and
 * a number is the only glyph that says so. The pastels follow the sheet's own
 * logic, so a step wears the colour its subject wears elsewhere on the page:
 * peach for the one-off setup, mint for the thing that then quietly keeps going,
 * lilac for the calendar.
 *
 * Step three is written "if you have one" on purpose. A house with no shared
 * calendar has to be able to read this list and still see itself in it.
 */
const STEPS = [
  { coin: "bg-peach", body: "Add your housemates and their mobile numbers." },
  { coin: "bg-mint", body: "Add the chores and who takes turns." },
  { coin: "bg-lilac", body: "Paste the house calendar link, if you have one." },
] as const;

/**
 * "How it works", sitting on the bare paper rather than in a pane. Everything
 * around it is a card or a lavender band, and a fourth box in that stack would
 * turn an orientation into another feature. Three numbered lines and a closing
 * sentence is the whole section.
 */
export function HowItWorks() {
  return (
    // The bottom padding is deliberate and larger than anything inside the
    // section. The closing caption has to belong to the three steps above it,
    // not to the white hand-off card below: if the gap that ends the section is
    // tighter than the gaps that hold it together, the whole block reads as
    // inserted. 56px here plus the hand-off section's own pt-6 gives 80px, in
    // line with the page's other section boundaries.
    <section className="pt-12 pb-12 md:pt-16 md:pb-14">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="font-heading text-2xl font-semibold text-balance md:text-3xl">
          How it works
        </h2>
      </div>

      {/* An <ol> because the order is the content. Tailwind's reset strips the
          markers, so the coin carries the number as real text: a screen reader
          reads "1" before the step rather than skipping it. */}
      <ol className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-7">
        {STEPS.map(({ coin, body }, index) => (
          <li key={body} className="flex items-start gap-3.5">
            <span
              className={cn(
                "font-heading grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold text-plum shadow-xs",
                coin,
              )}
              data-numeric
            >
              {index + 1}
            </span>
            <span className="text-base text-pretty">{body}</span>
          </li>
        ))}
      </ol>

      {/* A hairline across the full width, so the closing line reads as the end
          of all three steps rather than a footnote to the middle column it
          happens to sit under. */}
      <p className="mt-8 border-t border-border pt-6 text-center text-base text-pretty text-muted-foreground">
        Rota Monster does the texting from here.
      </p>
    </section>
  );
}
