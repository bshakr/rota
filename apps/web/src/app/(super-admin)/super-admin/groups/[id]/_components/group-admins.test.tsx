import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { groupDetailSchema } from "@/lib/api/super-admin-groups";
import { NO_EMAIL, NO_NAME } from "@/lib/hq-groups";
import { FIXTURE_NOW, groupPayload } from "@/test/group-payload";

import { GroupAdmins } from "./group-admins";

/**
 * The one render test in this app, and it earns its place: the bug it covers
 * (https://linear.app/bloombase/issue/BLO-1694) was a payload the schema refused
 * and a card that had nothing to say about it, so proving either half alone would
 * have proved nothing. This walks the whole way — the JSON Rails actually sends,
 * through the parse, into the markup.
 *
 * Rendered with `renderToStaticMarkup` rather than a DOM: `GroupAdmins` is a
 * Server Component with no state, no effects and no event handlers, so the string
 * IS what the operator gets, and this needs neither jsdom nor testing-library to
 * assert on it.
 */
function markup() {
  const detail = groupDetailSchema.parse(groupPayload());
  return renderToStaticMarkup(<GroupAdmins admins={detail.report.admins} now={FIXTURE_NOW} />);
}

/** The card's headings, in order — the `font-heading` line of each row. */
function headings(html: string): string[] {
  return [...html.matchAll(/<p class="[^"]*font-heading[^"]*">([^<]*)<\/p>/g)].map(
    (match) => match[1],
  );
}

describe("GroupAdmins", () => {
  it("parses the payload Rails sends and names every admin on it", () => {
    expect(headings(markup())).toEqual([
      "Priya Raman",
      "Dan Okoro",
      // No name, so the address is promoted into the heading.
      "rosa@example.com",
      // Neither, so the phrase is.
      NO_NAME,
    ]);
  });

  it("says what is missing rather than leaving a blank line", () => {
    const html = markup();

    // Once under the promoted address, once under the phrase-only row.
    expect(html.split(NO_NAME)).toHaveLength(3);
    // Dan's placeholder address, and the admin who has neither.
    expect(html.split(NO_EMAIL)).toHaveLength(3);
  });

  it("never renders an empty heading", () => {
    const html = markup();
    expect(headings(html)).toHaveLength(4);
    for (const heading of headings(html)) expect(heading.trim()).not.toBe("");
  });

  // The phrase is a stand-in, not a fact about the person; an address is a fact,
  // so only the first is muted.
  it("mutes the stand-in heading and not the promoted address", () => {
    const html = markup();
    const muted = [
      ...html.matchAll(/<p class="([^"]*font-heading[^"]*)">([^<]*)<\/p>/g),
    ].filter((match) => match[1].includes("text-muted-foreground"));

    expect(muted.map((match) => match[2])).toEqual([NO_NAME]);
  });
});
