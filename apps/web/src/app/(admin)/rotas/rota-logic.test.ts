import { describe, expect, it } from "vitest";

import type { RotaPositionEntry } from "@/lib/api/types";

import {
  dayStringToDisplayDate,
  displayDateToDayString,
  formatDayString,
  parseDayString,
  projectShifts,
  reminderOffsetLabel,
  scheduleLabel,
  sendHourLabel,
  sortOffsetsDesc,
  todayDayString,
} from "./rota-logic";

function member(id: number, name: string, position: number): RotaPositionEntry {
  return { member_id: id, name, position };
}

describe("reminderOffsetLabel", () => {
  it("renders 0 as 'on the day', never '0 days before'", () => {
    expect(reminderOffsetLabel(0)).toBe("on the day");
  });

  it("singularises one day", () => {
    expect(reminderOffsetLabel(1)).toBe("1 day before");
  });

  it("pluralises the rest", () => {
    expect(reminderOffsetLabel(3)).toBe("3 days before");
    expect(reminderOffsetLabel(7)).toBe("7 days before");
  });
});

describe("sortOffsetsDesc", () => {
  it("orders longest lead first, day-of last", () => {
    expect(sortOffsetsDesc([0, 7, 3])).toEqual([7, 3, 0]);
  });

  it("does not mutate the input", () => {
    const input = [3, 0, 7];
    sortOffsetsDesc(input);
    expect(input).toEqual([3, 0, 7]);
  });
});

describe("scheduleLabel", () => {
  it("says the interval in plain words", () => {
    expect(scheduleLabel(1, "day")).toBe("Every day");
    expect(scheduleLabel(1, "week")).toBe("Every week");
    expect(scheduleLabel(1, "month")).toBe("Every month");
    expect(scheduleLabel(2, "week")).toBe("Every 2 weeks");
    expect(scheduleLabel(3, "day")).toBe("Every 3 days");
    expect(scheduleLabel(2, "month")).toBe("Every 2 months");
  });
});

describe("sendHourLabel", () => {
  it("renders a 24-hour clock, zero-padded", () => {
    expect(sendHourLabel(9)).toBe("09:00");
    expect(sendHourLabel(0)).toBe("00:00");
    expect(sendHourLabel(17)).toBe("17:00");
  });
});

describe("civil date helpers", () => {
  it("parses and re-formats a YYYY-MM-DD day string", () => {
    expect(parseDayString("2026-07-04")).toEqual({ year: 2026, month: 7, day: 4 });
    expect(formatDayString({ year: 2026, month: 7, day: 4 })).toBe("2026-07-04");
    expect(formatDayString({ year: 2026, month: 12, day: 9 })).toBe("2026-12-09");
  });

  it("round-trips a day string through a display Date without slipping a day", () => {
    const date = dayStringToDisplayDate("2026-07-04");
    expect(displayDateToDayString(date)).toBe("2026-07-04");
  });

  it("reads today's civil date in the pinned timezone", () => {
    // 2026-07-04 00:30 UTC is still 4 July in Europe/London (01:30 BST).
    expect(todayDayString(new Date("2026-07-04T00:30:00Z"))).toBe("2026-07-04");
    // A New Year instant just before midnight UTC is already the new day in London.
    expect(todayDayString(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("projectShifts", () => {
  const roster = [member(1, "Alice", 0), member(2, "Bob", 1), member(3, "Cara", 2)];

  it("wraps the roster by occurrence index — the order IS the rotation", () => {
    const shifts = projectShifts({
      startsOn: "2026-07-04",
      intervalCount: 1,
      intervalUnit: "week",
      roster,
      count: 4,
    });
    expect(shifts.map((s) => s.dueOn)).toEqual([
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
      "2026-07-25",
    ]);
    expect(shifts.map((s) => s.member.name)).toEqual(["Alice", "Bob", "Cara", "Alice"]);
  });

  it("multiplies the interval count", () => {
    const shifts = projectShifts({
      startsOn: "2026-07-04",
      intervalCount: 2,
      intervalUnit: "week",
      roster,
      count: 3,
    });
    expect(shifts.map((s) => s.dueOn)).toEqual(["2026-07-04", "2026-07-18", "2026-08-01"]);
  });

  it("adds days directly", () => {
    const shifts = projectShifts({
      startsOn: "2026-07-04",
      intervalCount: 3,
      intervalUnit: "day",
      roster,
      count: 3,
    });
    expect(shifts.map((s) => s.dueOn)).toEqual(["2026-07-04", "2026-07-07", "2026-07-10"]);
  });

  it("clamps month arithmetic to the end of a short month (31 Jan + 1 month → 28 Feb)", () => {
    const shifts = projectShifts({
      startsOn: "2026-01-31",
      intervalCount: 1,
      intervalUnit: "month",
      roster,
      count: 4,
    });
    expect(shifts.map((s) => s.dueOn)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("skips past occurrences but keeps the assignee tied to the true occurrence index", () => {
    const pair = [member(1, "Alice", 0), member(2, "Bob", 1)];
    const shifts = projectShifts({
      startsOn: "2026-07-04",
      intervalCount: 1,
      intervalUnit: "week",
      roster: pair,
      count: 2,
      fromDay: "2026-07-15",
    });
    // Occurrences 0..3 are 07-04(A),07-11(B),07-18(A),07-25(B); from 07-15 keeps the last two.
    expect(shifts.map((s) => s.dueOn)).toEqual(["2026-07-18", "2026-07-25"]);
    expect(shifts.map((s) => s.member.name)).toEqual(["Alice", "Bob"]);
  });

  it("is empty for a draft rota with no roster", () => {
    expect(
      projectShifts({
        startsOn: "2026-07-04",
        intervalCount: 1,
        intervalUnit: "week",
        roster: [],
        count: 4,
      }),
    ).toEqual([]);
  });
});
