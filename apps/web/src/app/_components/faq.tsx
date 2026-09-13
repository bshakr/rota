import { FAQ_ITEMS, faqJsonLd } from "./faq-content";

/**
 * The questions a visitor is already asking by the time they reach the bottom of
 * the page: what it costs, what their housemates have to do, and what happens to
 * the house calendar.
 *
 * A plain description list rather than a stack of <details>. Six short answers
 * are shorter than the accordion that would hide them, every answer is visible
 * to a reader and to a crawler without a click, and there is no disclosure
 * widget whose focus ring and no-JS behaviour have to be got right. `<dl>` is
 * already the element for a list of term and description pairs.
 *
 * The FAQPage graph next to it is built from the same array as the visible copy
 * (see faq-content.ts), so the structured data cannot drift from the page.
 */
export function Faq() {
  return (
    <section className="pt-12 md:pt-16">
      <script
        type="application/ld+json"
        // JSON-LD is injected as raw text by design. `faqJsonLd` escapes every
        // `<` to `<` first, so no answer can ever close this tag.
        dangerouslySetInnerHTML={{ __html: faqJsonLd() }}
      />

      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="font-heading text-2xl font-semibold text-balance md:text-3xl">
          Questions
        </h2>
      </div>

      {/* CSS columns rather than a two-column grid. A grid aligns rows, so the
          one-line answer about not using Google Calendar would hold open a gap
          the height of its four-line neighbour and leave the card bottom-heavy.
          Columns flow and balance instead, and reading order stays top to bottom
          down the first column, which is what a description list should do. */}
      <dl className="mt-7 rounded-3xl bg-card p-6 shadow-sm md:columns-2 md:gap-10 md:p-10">
        {FAQ_ITEMS.map(({ question, answer }) => (
          // Each pair is one unbreakable block, so a question never ends a
          // column with its answer stranded at the top of the next one.
          <div key={question} className="mb-6 break-inside-avoid last:mb-0 md:mb-7">
            <dt className="font-heading text-base leading-snug font-semibold">{question}</dt>
            <dd className="mt-1.5 text-sm text-pretty text-muted-foreground">{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
