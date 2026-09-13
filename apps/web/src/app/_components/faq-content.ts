/**
 * The homepage questions, and the FAQPage graph built from them.
 *
 * One array, two readers: `<Faq>` renders it for a person, and `faqJsonLd()`
 * serialises the same entries for a search engine. Keeping them in one plain
 * module rather than inside the component is what makes "the structured data
 * says what the page says" a fact instead of a promise, and it lets the test
 * run without a DOM.
 *
 * The answers stay inside what the product actually does today. No STOP
 * handling, no reply by text and no escalation is claimed, because none of
 * those is built.
 */
export type FaqItem = {
  readonly question: string;
  readonly answer: string;
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "Is it free?",
    answer: "Yes. Rota Monster pays for the texts.",
  },
  {
    question: "Does everyone need the app?",
    answer:
      "There is no app. You add the numbers. Each housemate’s first text arrives with their first turn, with a link to their own page.",
  },
  {
    question: "What if people ignore the text?",
    answer:
      "You choose when reminders go out, say two days before and on the day. Everybody can see who was up, so if the bins still went nowhere the conversation is short.",
  },
  {
    question: "What if we don’t use Google Calendar?",
    answer: "Skip that bit. The rota runs on its own.",
  },
  {
    question: "What does it do with our calendar?",
    answer:
      "Reads titles and dates, keeps the link like a password and never shows it in full again. Descriptions and guests never leave Google. Disconnect deletes everything.",
  },
  {
    question: "What if someone moves out?",
    answer:
      "Remove them in one tap. Their turns pass to whoever is next and their link stops working.",
  },
] as const;

/**
 * The FAQPage graph, ready to drop into a `<script type="application/ld+json">`.
 *
 * Every `<` becomes `<` before the string reaches the DOM. JSON-LD is
 * injected as raw text, so an answer that ever contained `</script>` would
 * close the tag early and spill the rest of the JSON into the page as markup.
 * None of the answers contains one today; escaping means none of them ever can.
 */
export function faqJsonLd(items: readonly FaqItem[] = FAQ_ITEMS): string {
  const graph = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return JSON.stringify(graph).replaceAll("<", "\\u003c");
}
