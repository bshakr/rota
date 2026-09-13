import { describe, expect, it } from "vitest";

import type { CalendarEventItem, MemberScheduleResponse, MemberShift } from "@/lib/api/types";

import {
  ALL_SHIFTS,
  buildFeed,
  hasShifts,
  matchesFilter,
  nextShiftByMember,
  nextUp,
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
    events: [],
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

describe("buildFeed with house events", () => {
  // Fri 25 Sept to Thu 1 Oct 2026; Alfie is id 2 here, the house's other member.
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

  it("gives an entry its own day row on a day with no shifts", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-20",
        shifts: [shift({ due_on: "2026-09-20" })],
        events: [greece, dinner],
      }),
      ALL_SHIFTS,
    );

    expect(feed.map((week) => week.label)).toEqual(["This week", "Next week", "28 Sept – 4 Oct"]);
    expect(feed[0].days.map((day) => day.due_on)).toEqual(["2026-09-20"]);
    expect(feed[0].days[0].events).toEqual([]);

    expect(feed[1].days.map((day) => day.due_on)).toEqual(["2026-09-25"]);
    expect(feed[1].days[0].shifts).toEqual([]);
    expect(feed[1].days[0].events.map((event) => event.id)).toEqual([77]);
    expect(feed[1].days[0].events[0].untilLabel).toBe("until Thu 1 Oct");
    expect(feed[1].days[0].events[0].memberNames).toEqual(["Bob"]);

    expect(feed[2].days[0].events.map((event) => event.id)).toEqual([91]);
  });

  it("hangs an entry off the row of a day that already has shifts", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-28",
        shifts: [shift({ due_on: "2026-10-01" })],
        events: [dinner],
      }),
      ALL_SHIFTS,
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].days).toHaveLength(1);
    expect(feed[0].days[0].shifts).toHaveLength(1);
    expect(feed[0].days[0].events.map((event) => event.id)).toEqual([91]);
  });

  it("orders days by date however the payload ordered the entries", () => {
    const feed = buildFeed(
      schedule({ today: "2026-09-20", shifts: [], events: [dinner, greece] }),
      ALL_SHIFTS,
    );

    expect(feed.flatMap((week) => week.days.map((day) => day.due_on))).toEqual([
      "2026-09-25",
      "2026-10-01",
    ]);
  });

  it("moves an away entry already under way onto today rather than dropping it", () => {
    // Greece ran 25 Sept to 1 Oct and today is the 27th: the trip started in the past
    // but Bob is away RIGHT NOW, which is the fact the feed exists to show.
    const feed = buildFeed(
      schedule({ today: "2026-09-27", shifts: [], events: [greece, dinner] }),
      ALL_SHIFTS,
    );

    expect(feed.flatMap((week) => week.days.map((day) => day.due_on))).toEqual([
      "2026-09-27",
      "2026-10-01",
    ]);
    expect(feed[0].days[0].events.map((event) => event.id)).toEqual([77]);
    // The "until" label carries the rest of the trip, so nothing is lost by moving it.
    expect(feed[0].days[0].events[0].untilLabel).toBe("until Thu 1 Oct");
  });

  it("moves a plain multi-day entry already under way onto today too", () => {
    // Nothing else renders a plain event, so dropping this one lost it from every
    // surface the member has.
    const works: CalendarEventItem = {
      id: 55,
      title: "Scaffolding up",
      starts_on: "2026-09-26",
      ends_on: "2026-09-30",
      all_day: true,
      start_time: null,
      kind: "event",
      member_ids: [],
    };

    const feed = buildFeed(schedule({ today: "2026-09-27", shifts: [], events: [works] }), ALL_SHIFTS);

    expect(feed[0].days[0].due_on).toBe("2026-09-27");
    expect(feed[0].days[0].events.map((event) => event.id)).toEqual([55]);
  });

  it("drops an entry that already ENDED, the same as a past shift", () => {
    const feed = buildFeed(
      schedule({ today: "2026-10-02", shifts: [], events: [greece, dinner] }),
      ALL_SHIFTS,
    );

    expect(feed).toEqual([]);
  });

  it("puts an in-progress entry on the same row as a shift already due today", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-27",
        shifts: [shift({ due_on: "2026-09-27" })],
        events: [greece],
      }),
      ALL_SHIFTS,
    );

    expect(feed[0].days).toHaveLength(1);
    expect(feed[0].days[0].due_on).toBe("2026-09-27");
    expect(feed[0].days[0].shifts).toHaveLength(1);
    expect(feed[0].days[0].events.map((event) => event.id)).toEqual([77]);
  });

  it("shows entries under 'Just me', where they are how you read your own week", () => {
    const feed = buildFeed(
      schedule({ today: "2026-09-20", shifts: [], events: [greece] }),
      { rota: { kind: "me" }, personId: null },
    );

    expect(feed[0].days[0].events.map((event) => event.id)).toEqual([77]);
  });

  it("hides entries while a rota chip is active, since they belong to no rota", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-20",
        shifts: [shift({ due_on: "2026-09-20" })],
        events: [greece, dinner],
      }),
      { rota: { kind: "rota", rotaId: 1 }, personId: null },
    );

    expect(feed.flatMap((week) => week.days.map((day) => day.due_on))).toEqual(["2026-09-20"]);
    expect(feed[0].days[0].events).toEqual([]);
  });
});

describe("hasShifts", () => {
  // Thu 1 Oct 2026, a house dinner nobody is on the hook for.
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

  it("is false for a feed built only from house calendar entries", () => {
    // The bug this guards: a person filter matching nothing still admits every house
    // entry, so the feed has weeks and the member is never told this person is free.
    const feed = buildFeed(schedule({ today: "2026-09-28", shifts: [], events: [dinner] }), {
      rota: { kind: "everyone" },
      personId: 2,
    });

    expect(feed.length).toBeGreaterThan(0);
    expect(hasShifts(feed)).toBe(false);
  });

  it("is true as soon as one day carries a shift", () => {
    const feed = buildFeed(
      schedule({
        today: "2026-09-28",
        shifts: [shift({ due_on: "2026-10-02", assigned_member: { id: 2, name: "Bob" } })],
        events: [dinner],
      }),
      { rota: { kind: "everyone" }, personId: 2 },
    );

    expect(hasShifts(feed)).toBe(true);
  });

  it("is false for an empty feed", () => {
    expect(hasShifts([])).toBe(false);
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

describe("nextUp", () => {
  it("leads with the viewer's own next turn and names the two after it", () => {
    const first = shift({ due_on: "2026-09-16" });
    const second = shift({ due_on: "2026-09-17" });
    const third = shift({ due_on: "2026-09-18" });
    const fourth = shift({ due_on: "2026-09-19" });

    const card = nextUp(
      schedule({ today: "2026-09-14", shifts: [fourth, second, first, third] }),
    );

    expect(card).toEqual({ kind: "shift", shift: first, then: [second, third] });
  });

  it("names the person holding a shift the viewer handed away, when nothing is left on their plate", () => {
    const handed = shift({
      due_on: "2026-11-14",
      rota_name: "Kitchen deep clean",
      covering_member: { id: 2, name: "Eliza" },
      can_cancel_cover: true,
    });

    expect(nextUp(schedule({ today: "2026-09-14", shifts: [handed] }))).toEqual({
      kind: "handed-off",
      shift: handed,
      to: "Eliza",
    });
  });

  it("picks the soonest handed-off shift when there are several", () => {
    const later = shift({ due_on: "2026-11-14", covering_member: { id: 2, name: "Eliza" } });
    const sooner = shift({ due_on: "2026-10-03", covering_member: { id: 3, name: "Raph" } });

    const card = nextUp(schedule({ today: "2026-09-14", shifts: [later, sooner] }));

    expect(card).toEqual({ kind: "handed-off", shift: sooner, to: "Raph" });
  });

  it("prefers a turn the viewer is responsible for over one they handed away", () => {
    // The handed-off shift is SOONER, and still loses: it is somebody else's to do.
    const handed = shift({ due_on: "2026-09-15", covering_member: { id: 2, name: "Eliza" } });
    const own = shift({ due_on: "2026-09-20" });

    const card = nextUp(schedule({ today: "2026-09-14", shifts: [handed, own] }));

    expect(card).toEqual({ kind: "shift", shift: own, then: [] });
  });

  it("ignores a shift the viewer handed away that has already passed", () => {
    const handed = shift({ due_on: "2026-09-10", covering_member: { id: 2, name: "Eliza" } });

    expect(nextUp(schedule({ today: "2026-09-14", shifts: [handed] }))).toEqual({
      kind: "nothing",
    });
  });

  it("ignores someone else's covered shift, which the viewer never had", () => {
    const theirs = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 2, name: "Bob" },
      covering_member: { id: 3, name: "Cara" },
    });

    expect(nextUp(schedule({ today: "2026-09-14", shifts: [theirs] }))).toEqual({
      kind: "nothing",
    });
  });

  it("says nothing at all when the viewer has no shifts either way", () => {
    const theirs = shift({ due_on: "2026-09-16", assigned_member: { id: 2, name: "Bob" } });

    expect(nextUp(schedule({ today: "2026-09-14", shifts: [theirs] }))).toEqual({
      kind: "nothing",
    });
  });

  it("can answer for any housemate, not just the viewer", () => {
    const bobs = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 2, name: "Bob" },
      covering_member: { id: 3, name: "Cara" },
    });

    expect(nextUp(schedule({ today: "2026-09-14", shifts: [bobs] }), 2)).toEqual({
      kind: "handed-off",
      shift: bobs,
      to: "Cara",
    });
  });
});
