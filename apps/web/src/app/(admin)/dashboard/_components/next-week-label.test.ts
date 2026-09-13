import { describe, expect, it } from "vitest";

import { turnsLabel } from "./next-week-label";

describe("turnsLabel", () => {
  it("counts turns in plain English, singular included", () => {
    expect(turnsLabel(6)).toBe("6 turns");
    expect(turnsLabel(2)).toBe("2 turns");
    expect(turnsLabel(1)).toBe("1 turn");
  });

  it("says 'No turns' rather than '0 turns'", () => {
    // The header is read closed, on its own, so it has to be a sentence a person
    // would say. "0 turns" is a database row; "No turns" is the answer.
    expect(turnsLabel(0)).toBe("No turns");
  });
});
