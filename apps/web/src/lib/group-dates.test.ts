import { describe, expect, it } from "vitest";

import { relativeDay } from "./date";
import {
  addCivilDays,
  civilDate,
  compareCivil,
  groupToday,
  isFutureOrToday,
  isThisWeek,
} from "./group-dates";

// These helpers are the whole timezone-correctness story for the dashboard and
// shifts screens. `due_on` is a civil date (YYYY-MM-DD, no zone); the ONLY place
// a real timezone enters is deciding what "today" is for the group. Everything
// downstream is civil-date arithmetic, so it can't drift with the host clock.

describe("groupToday", () => {
  it("resolves the civil date in the group's own timezone", () => {
    // 23:30 UTC on the 13th: already the 14th in London/Auckland, still the 13th
    // in UTC and New York. This is the exact "9am vs 8am" class of bug.
    const lateEvening = new Date("2026-07-13T23:30:00Z");
    expect(groupToday(lateEvening, "Europe/London")).toBe("2026-07-14");
    expect(groupToday(lateEvening, "UTC")).toBe("2026-07-13");
    expect(groupToday(lateEvening, "America/New_York")).toBe("2026-07-13");
    expect(groupToday(lateEvening, "Pacific/Auckland")).toBe("2026-07-14");
  });

  it("rolls the other way before dawn in western zones", () => {
    const earlyMorning = new Date("2026-07-13T02:00:00Z");
    expect(groupToday(earlyMorning, "Europe/London")).toBe("2026-07-13");
    expect(groupToday(earlyMorning, "America/Los_Angeles")).toBe("2026-07-12");
  });
});

describe("civilDate", () => {
  it("parses a YYYY-MM-DD to noon UTC so no formatter can shift the day", () => {
    const d = civilDate("2026-07-13");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6); // 0-based July
    expect(d.getUTCDate()).toBe(13);
    expect(d.getUTCHours()).toBe(12);
  });

  it("round-trips through the existing relativeDay formatter", () => {
    const today = "2026-07-13";
    expect(relativeDay(civilDate(today), civilDate(today))).toBe("today");
    expect(relativeDay(civilDate("2026-07-14"), civilDate(today))).toBe("tomorrow");
    expect(relativeDay(civilDate("2026-07-16"), civilDate(today))).toBe("in 3 days");
    expect(relativeDay(civilDate("2026-07-12"), civilDate(today))).toBe("yesterday");
  });
});

describe("addCivilDays", () => {
  it("adds and subtracts whole days across a month boundary", () => {
    expect(addCivilDays("2026-07-13", 6)).toBe("2026-07-19");
    expect(addCivilDays("2026-07-30", 3)).toBe("2026-08-02");
    expect(addCivilDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("crosses a DST transition without losing a day", () => {
    // UK clocks go back on 2026-10-25. Civil arithmetic must be immune to it.
    expect(addCivilDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("compareCivil", () => {
  it("orders civil dates chronologically", () => {
    expect(compareCivil("2026-07-13", "2026-07-14")).toBeLessThan(0);
    expect(compareCivil("2026-07-14", "2026-07-13")).toBeGreaterThan(0);
    expect(compareCivil("2026-07-13", "2026-07-13")).toBe(0);
  });
});

describe("isThisWeek", () => {
  const today = "2026-07-13";

  it("includes today and the six days after it", () => {
    expect(isThisWeek("2026-07-13", today)).toBe(true);
    expect(isThisWeek("2026-07-19", today)).toBe(true); // today + 6
  });

  it("excludes yesterday and next week", () => {
    expect(isThisWeek("2026-07-12", today)).toBe(false);
    expect(isThisWeek("2026-07-20", today)).toBe(false); // today + 7
  });
});

describe("isFutureOrToday", () => {
  const today = "2026-07-13";

  it("is true for today and later, false for the past", () => {
    expect(isFutureOrToday("2026-07-13", today)).toBe(true);
    expect(isFutureOrToday("2026-12-31", today)).toBe(true);
    expect(isFutureOrToday("2026-07-12", today)).toBe(false);
  });
});
