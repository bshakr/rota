import { describe, expect, it } from "vitest";

import type { CalendarEventItem, MemberRef } from "@/lib/api/types";

import { buildDayRows, dateRangeLabel, eventsByDay, nextWeekRangeLabel } from "./day-rows";

const members: MemberRef[] = [
  { id: 1, name: "Bass" },
  { id: 2, name: "Bob" },
];

// Fri 25 Sept to Thu 1 Oct 2026, all day.
const greece: CalendarEventItem = {
  id: 77,
  title: "Bob in Greece",
  starts_on: "2026-09-25",
  ends_on: "2026-10-01",
  all_day: true,
  start_time: null,
  kind: "away",
  member_ids: [2],
};

// Thu 1 Oct 2026, 19:00.
const dinner: CalendarEventItem = {
  id: 91,
  title: "House dinner at home",
  starts_on: "2026-10-01",
  ends_on: "2026-10-01",
  all_day: false,
  start_time: "19:00",
  kind: "event",
  member_ids: [],
};

// A shift is anything with an id and a civil due date; the row builder is generic
// over it so the admin's `Shift` and the member's `MemberShift` share one function.
function shift(id: number, due_on: string) {
  return { id, due_on };
}

describe("eventsByDay", () => {
  it("keys an entry by the day it begins", () => {
    const days = eventsByDay([greece, dinner], "2026-09-20", members);

    expect([...days.keys()]).toEqual(["2026-09-25", "2026-10-01"]);
    expect(days.get("2026-09-25")?.map((event) => event.id)).toEqual([77]);
    expect(days.get("2026-09-25")?.[0].memberNames).toEqual(["Bob"]);
    expect(days.get("2026-09-25")?.[0].untilLabel).toBe("until Thu 1 Oct");
  });

  it("lands an entry already under way on today rather than dropping it", () => {
    const days = eventsByDay([greece], "2026-09-27", members);

    expect([...days.keys()]).toEqual(["2026-09-27"]);
    expect(days.get("2026-09-27")?.[0].untilLabel).toBe("until Thu 1 Oct");
  });

  it("drops an entry that already ended", () => {
    expect(eventsByDay([greece, dinner], "2026-10-02", members).size).toBe(0);
  });

  it("puts all-day entries above timed ones on the same day", () => {
    // Same day, payload order deliberately the wrong way round: a trip frames the
    // whole day, so it reads before the thing that happens at seven.
    const allDay: CalendarEventItem = { ...greece, id: 5, starts_on: "2026-10-01" };
    const days = eventsByDay([dinner, allDay], "2026-09-30", members);

    expect(days.get("2026-10-01")?.map((event) => event.id)).toEqual([5, 91]);
  });

  it("orders two timed entries by the clock, then by id", () => {
    const lunch: CalendarEventItem = { ...dinner, id: 40, start_time: "12:30" };
    const alsoSeven: CalendarEventItem = { ...dinner, id: 12 };
    const days = eventsByDay([dinner, alsoSeven, lunch], "2026-10-01", members);

    expect(days.get("2026-10-01")?.map((event) => event.id)).toEqual([40, 12, 91]);
  });
});

describe("buildDayRows", () => {
  it("walks the union of shift days and event days, in date order", () => {
    const eventDays = eventsByDay([greece, dinner], "2026-09-20", members);
    const rows = buildDayRows([shift(1, "2026-10-01"), shift(2, "2026-09-20")], eventDays);

    expect(rows.map((row) => row.due_on)).toEqual(["2026-09-20", "2026-09-25", "2026-10-01"]);
  });

  it("gives a day carrying only an entry its own row", () => {
    const eventDays = eventsByDay([greece], "2026-09-20", members);
    const rows = buildDayRows([shift(1, "2026-09-20")], eventDays);

    const trip = rows.find((row) => row.due_on === "2026-09-25");
    expect(trip?.shifts).toEqual([]);
    expect(trip?.events.map((event) => event.id)).toEqual([77]);
  });

  it("hangs an entry off a day that already has shifts", () => {
    const eventDays = eventsByDay([dinner], "2026-09-28", members);
    const rows = buildDayRows([shift(1, "2026-10-01")], eventDays);

    expect(rows).toHaveLength(1);
    expect(rows[0].shifts.map((s) => s.id)).toEqual([1]);
    expect(rows[0].events.map((event) => event.id)).toEqual([91]);
  });

  it("keeps the shift order it was given within a day", () => {
    // The callers sort by day then rota name; the builder must not re-sort behind
    // them, or two jobs due the same day would read in a different order here than
    // everywhere else on the screen.
    const rows = buildDayRows(
      [shift(9, "2026-09-20"), shift(3, "2026-09-20"), shift(7, "2026-09-20")],
      new Map(),
    );

    expect(rows[0].shifts.map((s) => s.id)).toEqual([9, 3, 7]);
  });

  it("gives every day an events array, so a row never asks whether a calendar exists", () => {
    const rows = buildDayRows([shift(1, "2026-09-20")], new Map());

    expect(rows[0].events).toEqual([]);
  });

  it("is empty when there is neither a shift nor an entry", () => {
    expect(buildDayRows([], new Map())).toEqual([]);
  });
});

describe("dateRangeLabel", () => {
  it("names one month once when the range sits inside it", () => {
    expect(dateRangeLabel("2026-10-05", "2026-10-11")).toBe("5–11 Oct");
  });

  it("names both months when the range straddles two", () => {
    expect(dateRangeLabel("2026-09-28", "2026-10-04")).toBe("28 Sept – 4 Oct");
  });

  it("straddles a new year the same way", () => {
    expect(dateRangeLabel("2026-12-28", "2027-01-03")).toBe("28 Dec – 3 Jan");
  });
});

describe("nextWeekRangeLabel", () => {
  it("labels the seven days that begin a week after today", () => {
    // Sun 13 Sept 2026: next week is Sun 20 Sept to Sat 26 Sept.
    expect(nextWeekRangeLabel("2026-09-13")).toBe("20–26 Sept");
  });

  it("straddles a month boundary", () => {
    // Mon 21 Sept: next week runs 28 Sept to 4 Oct.
    expect(nextWeekRangeLabel("2026-09-21")).toBe("28 Sept – 4 Oct");
  });
});
