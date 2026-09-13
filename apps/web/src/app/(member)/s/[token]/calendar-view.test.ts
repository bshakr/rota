import { describe, expect, it } from "vitest";

import type { CalendarEventItem, ScheduleMember } from "@/lib/api/types";

import {
  awayLabel,
  awayMemberIdsOn,
  eventMetaLabel,
  eventRangeLabel,
  eventRowLabel,
  eventsStartingOn,
  toFeedEvent,
} from "./calendar-view";

const members: ScheduleMember[] = [
  { id: 1, name: "Bass", contactable: true },
  { id: 5, name: "Alfie", contactable: true },
  { id: 6, name: "Ciara", contactable: true },
];

// Fri 25 Sept to Thu 1 Oct 2026.
const greece: CalendarEventItem = {
  id: 77,
  title: "Alfie in Greece",
  starts_on: "2026-09-25",
  ends_on: "2026-10-01",
  all_day: true,
  start_time: null,
  kind: "away",
  member_ids: [5],
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

// Thu 17 to Sat 19 Sept 2026.
const trip: CalendarEventItem = {
  id: 12,
  title: "Bass and Ciara France",
  starts_on: "2026-09-17",
  ends_on: "2026-09-19",
  all_day: true,
  start_time: null,
  kind: "away",
  member_ids: [1, 6],
};

describe("eventsStartingOn", () => {
  it("places an event on its first day only", () => {
    expect(eventsStartingOn([greece, dinner], "2026-09-25").map((e) => e.id)).toEqual([77]);
    expect(eventsStartingOn([greece, dinner], "2026-09-26")).toEqual([]);
    expect(eventsStartingOn([greece, dinner], "2026-10-01").map((e) => e.id)).toEqual([91]);
  });
});

describe("awayMemberIdsOn", () => {
  it("knows who is away on a date, inclusive of both ends", () => {
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-09-25")).toEqual([5]);
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-10-01")).toEqual([5]);
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-10-02")).toEqual([]);
    expect(awayMemberIdsOn([greece, trip, dinner], "2026-09-19")).toEqual([1, 6]);
  });

  it("counts the middle of a trip, not just its ends", () => {
    expect(awayMemberIdsOn([greece], "2026-09-27")).toEqual([5]);
  });

  it("ignores plain events, however long they run", () => {
    const party: CalendarEventItem = { ...dinner, starts_on: "2026-09-20", ends_on: "2026-09-30" };
    expect(awayMemberIdsOn([party], "2026-09-25")).toEqual([]);
  });

  it("merges overlapping trips into one ascending list, without repeats", () => {
    const alsoAlfie: CalendarEventItem = { ...trip, id: 13, member_ids: [5, 1] };
    expect(awayMemberIdsOn([trip, alsoAlfie], "2026-09-18")).toEqual([1, 5, 6]);
  });
});

describe("eventRangeLabel", () => {
  it("names the last day of a multi-day entry", () => {
    expect(eventRangeLabel(greece)).toBe("until Thu 1 Oct");
  });

  it("says nothing about a single-day entry", () => {
    expect(eventRangeLabel(dinner)).toBeNull();
  });
});

describe("awayLabel", () => {
  it("joins the names of everyone on the trip", () => {
    expect(awayLabel(trip, members)).toBe("Bass and Ciara away");
    expect(awayLabel(greece, members)).toBe("Alfie away");
  });

  it("falls back to the calendar's own words when nobody was matched", () => {
    // The API maps a title to housemates; when it matched none, "away" alone
    // would name nobody, so the row keeps the title the calendar actually had.
    expect(awayLabel({ ...greece, member_ids: [] }, members)).toBe("Alfie in Greece");
    expect(awayLabel({ ...greece, member_ids: [999] }, members)).toBe("Alfie in Greece");
  });
});

describe("toFeedEvent", () => {
  it("builds a feed event", () => {
    expect(toFeedEvent(dinner, members)).toEqual({
      id: 91,
      title: "House dinner at home",
      kind: "event",
      timeLabel: "19:00",
      untilLabel: null,
      memberNames: [],
    });
    expect(toFeedEvent(greece, members)).toEqual({
      id: 77,
      title: "Alfie in Greece",
      kind: "away",
      timeLabel: null,
      untilLabel: "until Thu 1 Oct",
      memberNames: ["Alfie"],
    });
  });

  it("drops the time of an all-day entry even when the API sent one", () => {
    expect(toFeedEvent({ ...greece, start_time: "09:00" }, members).timeLabel).toBeNull();
  });
});

describe("eventRowLabel and eventMetaLabel", () => {
  it("reads '{names} away · {range}' for a trip", () => {
    const event = toFeedEvent(greece, members);
    expect(eventRowLabel(event)).toBe("Alfie away");
    expect(eventMetaLabel(event)).toBe("until Thu 1 Oct");
  });

  it("reads the title and the time for a house event", () => {
    const event = toFeedEvent(dinner, members);
    expect(eventRowLabel(event)).toBe("House dinner at home");
    expect(eventMetaLabel(event)).toBe("19:00");
  });

  it("prefers the time to the range when an event has both", () => {
    const event = toFeedEvent({ ...dinner, ends_on: "2026-10-03" }, members);
    expect(eventMetaLabel(event)).toBe("19:00");
  });

  it("says nothing extra about a single-day all-day event", () => {
    const event = toFeedEvent({ ...dinner, all_day: true, start_time: null }, members);
    expect(eventMetaLabel(event)).toBeNull();
  });

  it("keeps the title when an away entry named nobody", () => {
    const event = toFeedEvent({ ...greece, member_ids: [] }, members);
    expect(eventRowLabel(event)).toBe("Alfie in Greece");
  });
});
