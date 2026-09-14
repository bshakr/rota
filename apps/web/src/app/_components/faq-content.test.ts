import { describe, expect, it } from "vitest";

import { FAQ_ITEMS, faqJsonLd } from "./faq-content";

describe("homepage FAQ structured data", () => {
  it("parses as JSON and describes six questions", () => {
    const graph = JSON.parse(faqJsonLd());

    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@type"]).toBe("FAQPage");
    expect(graph.mainEntity).toHaveLength(6);
    expect(FAQ_ITEMS).toHaveLength(6);
  });

  // The whole reason the copy lives in one array: a search engine and a reader
  // must never be shown different answers.
  it("carries the same questions and answers the page renders", () => {
    const graph = JSON.parse(faqJsonLd());

    expect(graph.mainEntity).toEqual(
      FAQ_ITEMS.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    );
  });

  // JSON-LD is injected as raw text. A stray `</script>` in an answer would
  // close the tag and spill the rest of the graph into the page as markup.
  it("escapes every < so an answer can never close the script tag", () => {
    const json = faqJsonLd([
      { question: "Does it break out?", answer: "Not with </script> in it." },
    ]);

    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c/script>");
    expect(JSON.parse(json).mainEntity[0].acceptedAnswer.text).toBe("Not with </script> in it.");
  });
});
