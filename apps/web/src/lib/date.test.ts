import { describe, expect, it } from "vitest";

import {
  formatDayNumber,
  formatLongDate,
  formatMonthShort,
  formatShiftDate,
  formatTimestamp,
  relativeDay,
} from "./date";

// These formatters run in CLIENT components (the member feed's week sections, the
// people card, the hand-off sheet), so their output is compared byte for byte
// between the server render and the browser's hydration. Node's ICU and a browser's
// ICU carry different CLDR revisions and disagree about en-GB's short-date pattern —
// Node "Sat 14 Nov", browser "Sat, 14 Nov" — which is a hydration mismatch on every
// date the feed prints. The fix is that no name or separator comes from Intl any
// more, and these examples are the lock on it: they pin the EXACT bytes, so a
// well-meant switch back to Intl fails here instead of in a browser console.

/** The noon-UTC instant for a civil date, exactly as `civilDate` builds it. */
const at = (civil: string) => new Date(`${civil}T12:00:00Z`);

describe("the date formatters are exact, not locale-dependent", () => {
  it.each([
    // A Sunday in September: "Sept", not "Sep", is what en-GB has always rendered.
    ["2026-09-13", "Sun 13 Sept", "13", "Sept", "Sunday, 13 September 2026"],
    // The review's example, and the one that differed between Node and the browser.
    ["2026-11-14", "Sat 14 Nov", "14", "Nov", "Saturday, 14 November 2026"],
    // Across a year boundary, and a one-digit day: no zero padding anywhere.
    ["2027-01-03", "Sun 3 Jan", "3", "Jan", "Sunday, 3 January 2027"],
  ])("renders %s", (civil, shift, day, month, long) => {
    expect(formatShiftDate(at(civil))).toBe(shift);
    expect(formatDayNumber(at(civil))).toBe(day);
    expect(formatMonthShort(at(civil))).toBe(month);
    expect(formatLongDate(at(civil))).toBe(long);
  });

  it("names every month the way the rest of the app does", () => {
    const months = Array.from({ length: 12 }, (_, index) =>
      formatMonthShort(new Date(Date.UTC(2026, index, 15, 12))),
    );

    expect(months).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sept",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });

  it("names every weekday, starting from a known Sunday", () => {
    // Sunday 4 January 2026 through Saturday 10 January 2026.
    const week = Array.from({ length: 7 }, (_, index) =>
      formatShiftDate(at(`2026-01-${String(4 + index).padStart(2, "0")}`)),
    );

    expect(week).toEqual([
      "Sun 4 Jan",
      "Mon 5 Jan",
      "Tue 6 Jan",
      "Wed 7 Jan",
      "Thu 8 Jan",
      "Fri 9 Jan",
      "Sat 10 Jan",
    ]);
  });
});

describe("formatTimestamp reads the clock in Europe/London, not UTC", () => {
  it("shifts an instant into British Summer Time", () => {
    // 08:00 UTC on 5 July is 09:00 BST.
    expect(formatTimestamp(new Date("2026-07-05T08:00:00Z"))).toBe("5 Jul, 09:00");
  });

  it("leaves a winter instant alone, because GMT is UTC", () => {
    expect(formatTimestamp(new Date("2026-01-05T09:30:00Z"))).toBe("5 Jan, 09:30");
  });

  it("rolls the DAY over when BST is already past midnight", () => {
    // 23:30 UTC on 5 July is 00:30 on the 6th in London — the whole reason the zone
    // is pinned, and the reason midnight must read "00" rather than "24".
    expect(formatTimestamp(new Date("2026-07-05T23:30:00Z"))).toBe("6 Jul, 00:30");
  });
});

describe("relativeDay counts whole calendar days in Europe/London", () => {
  it("names today, tomorrow and yesterday", () => {
    expect(relativeDay(at("2026-09-13"), at("2026-09-13"))).toBe("today");
    expect(relativeDay(at("2026-09-14"), at("2026-09-13"))).toBe("tomorrow");
    expect(relativeDay(at("2026-09-12"), at("2026-09-13"))).toBe("yesterday");
  });

  it("counts further days in both directions", () => {
    expect(relativeDay(at("2026-09-16"), at("2026-09-13"))).toBe("in 3 days");
    expect(relativeDay(at("2026-09-10"), at("2026-09-13"))).toBe("3 days ago");
  });

  it("counts across the spring DST change, where one day is 23 hours long", () => {
    // The clocks go forward on Sunday 29 March 2026. A naive millisecond division
    // would call this "in 2 days" for part of the range.
    expect(relativeDay(at("2026-03-30"), at("2026-03-28"))).toBe("in 2 days");
  });
});
