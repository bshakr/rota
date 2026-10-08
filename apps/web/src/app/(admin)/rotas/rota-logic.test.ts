import { describe, expect, it } from "vitest";

import type { RotaPositionEntry } from "@/lib/api/types";

import {
  dayStringToDisplayDate,
  displayDateToDayString,
  formatDayString,
  parseDayString,
  projectShifts,
  daysBeforeFromTiming,
  formErrorPath,
  MAX_DAYS_AFTER,
  reminderParams,
  reminderRows,
  remindersInWords,
  reminderTimingLabel,
  scheduleLabel,
  sendHourLabel,
  timingFromDaysBefore,
  todayDayString,
  withTimingDirection,
} from "./rota-logic";

function member(id: number, name: string, position: number): RotaPositionEntry {
  return { member_id: id, name, position };
}

describe("reminderTimingLabel", () => {
  it("renders 0 as 'On the day', never '0 days before'", () => {
    expect(reminderTimingLabel(0)).toBe("On the day");
  });

  it("says before for positive days, singular and plural", () => {
    expect(reminderTimingLabel(1)).toBe("1 day before");
    expect(reminderTimingLabel(3)).toBe("3 days before");
  });

  it("says after for negative days and never shows the minus sign", () => {
    expect(reminderTimingLabel(-1)).toBe("1 day after");
    expect(reminderTimingLabel(-2)).toBe("2 days after");
    expect(reminderTimingLabel(-14)).not.toContain("-");
  });
});

describe("remindersInWords", () => {
  it("lists longest lead first, after-shift reminders last", () => {
    expect(remindersInWords([0, -1, 3])).toBe("3 days before, on the day, 1 day after");
  });

  it("capitalises only the first item", () => {
    expect(remindersInWords([0, 2])).toBe("2 days before, on the day");
    expect(remindersInWords([0])).toBe("On the day");
  });

  it("keeps duplicates, since two messages may share a day", () => {
    expect(remindersInWords([0, 0])).toBe("On the day, on the day");
  });

  it("says so when there are none", () => {
    expect(remindersInWords([])).toBe("No reminders");
  });

  it("does not mutate the input", () => {
    const input = [0, 3];
    remindersInWords(input);
    expect(input).toEqual([0, 3]);
  });
});

describe("timingFromDaysBefore / daysBeforeFromTiming", () => {
  it("splits a signed day count into an amount and a direction", () => {
    expect(timingFromDaysBefore(3)).toEqual({ amount: 3, direction: "before" });
    expect(timingFromDaysBefore(0)).toEqual({ amount: 0, direction: "on" });
    expect(timingFromDaysBefore(-1)).toEqual({ amount: 1, direction: "after" });
    expect(timingFromDaysBefore(-14)).toEqual({ amount: 14, direction: "after" });
  });

  it("round-trips", () => {
    for (const d of [365, 3, 1, 0, -1, -14]) {
      expect(daysBeforeFromTiming(timingFromDaysBefore(d))).toBe(d);
    }
  });

  it("ignores the amount on the day", () => {
    expect(daysBeforeFromTiming({ amount: 5, direction: "on" })).toBe(0);
  });
});

describe("withTimingDirection", () => {
  it("starts at 1 when leaving 'on the day', so the label never lies", () => {
    expect(withTimingDirection(0, "before")).toBe(1);
    expect(withTimingDirection(0, "after")).toBe(-1);
  });

  it("keeps the amount when flipping between before and after", () => {
    expect(withTimingDirection(3, "after")).toBe(-3);
    expect(withTimingDirection(-2, "before")).toBe(2);
  });

  it("clamps to the after-shift limit", () => {
    expect(withTimingDirection(30, "after")).toBe(-MAX_DAYS_AFTER);
  });

  it("goes to 0 for on the day", () => {
    expect(withTimingDirection(-3, "on")).toBe(0);
  });
});

describe("reminderRows / reminderParams", () => {
  const saved = [
    { id: 11, days_before: 3, message_template: "Soon, {{name}}" },
    { id: 12, days_before: -1, message_template: "Thanks, {{name}}" },
  ];

  it("keeps each saved reminder's id through the form and back", () => {
    const params = reminderParams(reminderRows(saved));
    expect(params).toEqual(saved);
  });

  it("sends new rows without an id", () => {
    expect(reminderParams([{ days_before: 0, message_template: "Hi" }])).toEqual([
      { days_before: 0, message_template: "Hi" },
    ]);
  });
});

describe("formErrorPath", () => {
  it("maps a nested reminder error onto its row", () => {
    expect(formErrorPath("reminders[1].message_template")).toBe("reminders.1.message_template");
    expect(formErrorPath("reminders[0].days_before")).toBe("reminders.0.days_before");
  });

  it("keeps the list-level reminders key", () => {
    expect(formErrorPath("reminders")).toBe("reminders");
  });

  it("passes known top-level fields through", () => {
    expect(formErrorPath("name")).toBe("name");
    expect(formErrorPath("send_hour")).toBe("send_hour");
  });

  it("drops keys the form has no field for", () => {
    expect(formErrorPath("reminder_offsets")).toBeNull();
    expect(formErrorPath("reminders[0].rota")).toBeNull();
    expect(formErrorPath("base")).toBeNull();
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

  it("wraps the roster by occurrence index: the order IS the rotation", () => {
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

  it("lands on 29 Feb in a leap year (monthly from a 31st), not 1/2 March", () => {
    const shifts = projectShifts({
      startsOn: "2024-01-31",
      intervalCount: 1,
      intervalUnit: "month",
      roster,
      count: 4,
    });
    expect(shifts.map((s) => s.dueOn)).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ]);
  });

  it("counts 29 Feb as a real day when stepping daily across a leap boundary", () => {
    const shifts = projectShifts({
      startsOn: "2024-02-28",
      intervalCount: 1,
      intervalUnit: "day",
      roster,
      count: 3,
    });
    expect(shifts.map((s) => s.dueOn)).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  });

  it("wraps cleanly across more than one full cycle of the roster", () => {
    const shifts = projectShifts({
      startsOn: "2026-07-04",
      intervalCount: 1,
      intervalUnit: "week",
      roster,
      count: 7, // 2 full cycles of 3 + 1
    });
    expect(shifts.map((s) => s.member.name)).toEqual([
      "Alice",
      "Bob",
      "Cara",
      "Alice",
      "Bob",
      "Cara",
      "Alice",
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

  it("still projects upcoming shifts for a rota that started long ago (no linear-scan cap)", () => {
    const pair = [member(1, "Alice", 0), member(2, "Bob", 1)];
    // A daily rota anchored ~4 years before fromDay: index reaches the thousands.
    const shifts = projectShifts({
      startsOn: "2022-01-01",
      intervalCount: 1,
      intervalUnit: "day",
      roster: pair,
      count: 3,
      fromDay: "2026-07-14",
    });
    expect(shifts.map((s) => s.dueOn)).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
    // 2022-01-01 → 2026-07-14 is occurrence 1655 (a leap-year-aware day count),
    // so the assignee must track that true index, not a reset counter.
    const daysBetween =
      (Date.UTC(2026, 6, 14) - Date.UTC(2022, 0, 1)) / 86_400_000;
    expect(shifts[0].member).toBe(pair[daysBetween % 2]);
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
