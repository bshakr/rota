import { describe, expect, it } from "vitest";

import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";

import {
  ALL_SHIFTS,
  buildFeed,
  matchesFilter,
  nextShiftByMember,
  responsibleShifts,
  shiftInvolves,
  weekLabel,
  weekStart,
} from "./schedule-view";

// The viewer is always id 1 in these fixtures; everyone else is a housemate.
const ME = 1;

let nextId = 100;

function shift(partial: Partial<MemberShift> & { due_on: string }): MemberShift {
  const assigned = partial.assigned_member ?? { id: ME, name: "Alice" };
  const covering = partial.covering_member ?? null;
  return {
    id: nextId++,
    rota_id: 1,
    rota_name: "Kitchen",
    covered: covering !== null,
    assigned_member: assigned,
    covering_member: covering,
    responsible_member: covering ?? assigned,
    can_assign_cover: false,
    can_cancel_cover: false,
    ...partial,
  };
}

function schedule(partial: Partial<MemberScheduleResponse> = {}): MemberScheduleResponse {
  return {
    today: "2026-09-13",
    timezone: "Europe/London",
    member: { id: ME, name: "Alice" },
    members: [
      { id: ME, name: "Alice", contactable: true },
      { id: 2, name: "Bob", contactable: true },
    ],
    rotas: [{ id: 1, name: "Kitchen" }],
    shifts: [],
    ...partial,
  };
}

describe("weekStart", () => {
  it("returns the Monday of the week containing a midweek day", () => {
    // Wednesday 16 September 2026.
    expect(weekStart("2026-09-16")).toBe("2026-09-14");
  });

  it("returns the day itself for a Monday", () => {
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
  });

  it("treats Sunday as the LAST day of its week, not the first", () => {
    // Sunday 13 September 2026 belongs to the week starting Monday 7 September.
    expect(weekStart("2026-09-13")).toBe("2026-09-07");
  });

  it("crosses a year boundary", () => {
    // Friday 1 January 2027 falls in the week starting Monday 28 December 2026.
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("weekLabel", () => {
  it("names the week containing today 'This week'", () => {
    expect(weekLabel("2026-09-14", "2026-09-16")).toBe("This week");
  });

  it("names the following week 'Next week'", () => {
    expect(weekLabel("2026-09-21", "2026-09-16")).toBe("Next week");
  });

  it("labels a later week by its range, collapsing a shared month", () => {
    // Mon 5 Oct to Sun 11 Oct 2026.
    expect(weekLabel("2026-10-05", "2026-09-16")).toBe("5–11 Oct");
  });

  it("spells both months out when a week straddles them", () => {
    // Mon 28 Sep to Sun 4 Oct 2026. "Sept", not "Sep": the month comes from the app-wide
    // formatMonthShort (pinned en-GB), which is what every other screen renders, so the
    // feed and the shift card can never disagree about what September is called.
    expect(weekLabel("2026-09-28", "2026-09-16")).toBe("28 Sept – 4 Oct");
  });

  it("handles a week that straddles the new year", () => {
    // Mon 28 Dec 2026 to Sun 3 Jan 2027.
    expect(weekLabel("2026-12-28", "2026-09-16")).toBe("28 Dec – 3 Jan");
  });

  it("gives 'This week' a single day when today is a Sunday", () => {
    // Sunday 13 Sep is the last day of the week that began Mon 7 Sep, so "This week"
    // still names that week; only today and later are ever rendered into it.
    expect(weekLabel("2026-09-07", "2026-09-13")).toBe("This week");
    expect(weekLabel("2026-09-14", "2026-09-13")).toBe("Next week");
  });
});

describe("shiftInvolves", () => {
  it("is true for the assignee and for the cover, false for anyone else", () => {
    const handedOff = shift({
      due_on: "2026-09-16",
      assigned_member: { id: ME, name: "Alice" },
      covering_member: { id: 2, name: "Bob" },
    });

    expect(shiftInvolves(handedOff, ME)).toBe(true);
    expect(shiftInvolves(handedOff, 2)).toBe(true);
    expect(shiftInvolves(handedOff, 3)).toBe(false);
  });
});

describe("matchesFilter", () => {
  const mine = shift({ due_on: "2026-09-16", assigned_member: { id: ME, name: "Alice" } });
  const theirs = shift({
    due_on: "2026-09-17",
    rota_id: 2,
    rota_name: "Bins",
    assigned_member: { id: 2, name: "Bob" },
  });

  it("lets everything through under the default filter", () => {
    expect(matchesFilter(mine, ALL_SHIFTS, ME)).toBe(true);
    expect(matchesFilter(theirs, ALL_SHIFTS, ME)).toBe(true);
  });

  it("'just me' keeps only shifts the viewer is on", () => {
    const filter = { rota: { kind: "me" } as const, personId: null };
    expect(matchesFilter(mine, filter, ME)).toBe(true);
    expect(matchesFilter(theirs, filter, ME)).toBe(false);
  });

  it("a rota filter keeps only that rota", () => {
    const filter = { rota: { kind: "rota" as const, rotaId: 2 }, personId: null };
    expect(matchesFilter(mine, filter, ME)).toBe(false);
    expect(matchesFilter(theirs, filter, ME)).toBe(true);
  });

  it("combines a person filter with a rota filter", () => {
    const bobsBins = { rota: { kind: "rota" as const, rotaId: 2 }, personId: 2 };
    const alicesBins = { rota: { kind: "rota" as const, rotaId: 2 }, personId: ME };
    expect(matchesFilter(theirs, bobsBins, ME)).toBe(true);
    expect(matchesFilter(theirs, alicesBins, ME)).toBe(false);
  });

  it("a person filter matches the cover as well as the assignee", () => {
    const covered = shift({
      due_on: "2026-09-18",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: 2, name: "Bob" },
    });
    expect(matchesFilter(covered, { rota: { kind: "everyone" }, personId: 2 }, ME)).toBe(true);
  });
});

describe("buildFeed", () => {
  it("buckets shifts into weeks and days, in order", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-14",
        shifts: [
          shift({ due_on: "2026-09-16" }),
          shift({ due_on: "2026-09-16", rota_id: 2, rota_name: "Bins" }),
          shift({ due_on: "2026-09-19" }),
          shift({ due_on: "2026-09-22" }),
        ],
      }),
      ALL_SHIFTS,
    );

    expect(feed.map((week) => week.label)).toEqual(["This week", "Next week"]);
    expect(feed[0].weekStart).toBe("2026-09-14");
    expect(feed[0].days.map((day) => day.due_on)).toEqual(["2026-09-16", "2026-09-19"]);
    expect(feed[0].days[0].shifts).toHaveLength(2);
    expect(feed[1].days.map((day) => day.due_on)).toEqual(["2026-09-22"]);
  });

  it("orders same-day shifts by rota name", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-14",
        shifts: [
          shift({ due_on: "2026-09-16", rota_id: 1, rota_name: "Kitchen" }),
          shift({ due_on: "2026-09-16", rota_id: 2, rota_name: "Bins" }),
        ],
      }),
      ALL_SHIFTS,
    );

    expect(feed[0].days[0].shifts.map((s) => s.rota_name)).toEqual(["Bins", "Kitchen"]);
  });

  it("drops anything before today, whatever the API sent", () => {
    const feed = buildFeed(
      schedule({ today: "2026-09-14", shifts: [shift({ due_on: "2026-09-13" })] }),
      ALL_SHIFTS,
    );

    expect(feed).toEqual([]);
  });

  it("puts today into 'This week' even when today is a Sunday", () => {
    const feed = buildFeed(
      schedule({ today: "2026-09-13", shifts: [shift({ due_on: "2026-09-13" })] }),
      ALL_SHIFTS,
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].label).toBe("This week");
    expect(feed[0].days.map((day) => day.due_on)).toEqual(["2026-09-13"]);
  });

  it("returns no weeks when the filter matches nothing", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-14",
        shifts: [shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } })],
      }),
      { rota: { kind: "me" }, personId: null },
    );

    expect(feed).toEqual([]);
  });
});

describe("responsibleShifts", () => {
  it("returns the viewer's own turns in order, including ones they are covering", () => {
    const own = shift({ due_on: "2026-09-20" });
    const covering = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 2, name: "Bob" },
      covering_member: { id: ME, name: "Alice" },
    });
    const handedOff = shift({
      due_on: "2026-09-18",
      assigned_member: { id: ME, name: "Alice" },
      covering_member: { id: 2, name: "Bob" },
    });

    const mine = responsibleShifts(schedule({ today: "2026-09-14", shifts: [own, covering, handedOff] }));

    // A shift handed away is no longer MINE to do, so it is not in this list, even though it still
    // appears in the feed with a "Take it back".
    expect(mine.map((s) => s.id)).toEqual([covering.id, own.id]);
  });

  it("can answer for any housemate", () => {
    const bobs = shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } });
    const mine = shift({ due_on: "2026-09-17" });

    expect(
      responsibleShifts(schedule({ today: "2026-09-14", shifts: [bobs, mine] }), 2).map((s) => s.id),
    ).toEqual([bobs.id]);
  });
});

describe("nextShiftByMember", () => {
  it("maps each person to the first shift they are responsible for", () => {
    const bobFirst = shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } });
    const bobLater = shift({ due_on: "2026-09-23", assigned_member: { id: 2, name: "Bob" } });
    const mine = shift({ due_on: "2026-09-17" });

    const next = nextShiftByMember(schedule({ today: "2026-09-14", shifts: [bobLater, bobFirst, mine] }));

    expect(next.get(2)?.id).toBe(bobFirst.id);
    expect(next.get(ME)?.id).toBe(mine.id);
  });

  it("credits the cover, not the assignee, for a covered shift", () => {
    const covered = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: 2, name: "Bob" },
    });

    const next = nextShiftByMember(schedule({ today: "2026-09-14", shifts: [covered] }));

    expect(next.get(2)?.id).toBe(covered.id);
    expect(next.has(3)).toBe(false);
  });
});
