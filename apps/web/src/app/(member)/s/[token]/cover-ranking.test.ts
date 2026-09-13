import { describe, expect, it } from "vitest";

import type {
  CalendarEventItem,
  MemberScheduleResponse,
  MemberShift,
  ScheduleMember,
} from "@/lib/api/types";

import { rankCoverCandidates, selectableCandidates } from "./cover-ranking";

const ME = 1;

let nextId = 500;

function person(id: number, name: string, contactable = true): ScheduleMember {
  return { id, name, contactable };
}

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
    can_assign_cover: true,
    can_cancel_cover: false,
    ...partial,
  };
}

function awayEvent(partial: Partial<CalendarEventItem> & { member_ids: number[] }): CalendarEventItem {
  return {
    id: nextId++,
    title: "Away",
    starts_on: "2026-09-23",
    ends_on: "2026-09-23",
    all_day: true,
    start_time: null,
    kind: "away",
    ...partial,
  };
}

/** The house calendar the schedule was fetched with. Empty unless a test says otherwise. */
function withEvents(
  base: MemberScheduleResponse,
  events: CalendarEventItem[],
): MemberScheduleResponse {
  return { ...base, events };
}

function schedule(
  members: ScheduleMember[],
  shifts: MemberShift[],
  today = "2026-09-14",
): MemberScheduleResponse {
  return {
    today,
    timezone: "Europe/London",
    member: { id: ME, name: "Alice" },
    members,
    rotas: [{ id: 1, name: "Kitchen" }],
    shifts,
    events: [],
  };
}

describe("rankCoverCandidates", () => {
  it("never offers the viewer or the shift's assignee", () => {
    const mine = shift({ due_on: "2026-09-16" });
    const ranked = rankCoverCandidates(
      mine,
      schedule([person(ME, "Alice"), person(2, "Bob")], [mine]),
    );

    const named = [...ranked.free, ...ranked.busy, ...ranked.unavailable].map((c) => c.member.name);
    expect(named).toEqual(["Bob"]);
  });

  it("never offers the assignee back their own shift when the viewer is only covering", () => {
    // Alice took Cara's turn and is now handing it on. Cara must not be offered it back:
    // the API rejects that as already_assignee.
    const covered = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: ME, name: "Alice" },
    });
    const ranked = rankCoverCandidates(
      covered,
      schedule([person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")], [covered]),
    );

    const named = [...ranked.free, ...ranked.busy, ...ranked.unavailable].map((c) => c.member.name);
    expect(named).toEqual(["Bob"]);
  });

  it("splits free from busy by whether they already have a turn THAT week", () => {
    const target = shift({ due_on: "2026-09-16" }); // Wed, week of Mon 14 Sep
    const bobsSameWeek = shift({
      due_on: "2026-09-18",
      rota_id: 2,
      rota_name: "Bins",
      assigned_member: { id: 2, name: "Bob" },
    });
    const carasNextWeek = shift({ due_on: "2026-09-23", assigned_member: { id: 3, name: "Cara" } });

    const ranked = rankCoverCandidates(
      target,
      schedule(
        [person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")],
        [target, bobsSameWeek, carasNextWeek],
      ),
    );

    expect(ranked.free.map((c) => c.member.name)).toEqual(["Cara"]);
    expect(ranked.busy.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.busy[0].weekShifts.map((s) => s.rota_name)).toEqual(["Bins"]);
  });

  it("puts people who can't be texted in their own group, whatever their load", () => {
    const target = shift({ due_on: "2026-09-16" });
    const ranked = rankCoverCandidates(
      target,
      schedule([person(ME, "Alice"), person(2, "Bob", false), person(3, "Cara")], [target]),
    );

    expect(ranked.free.map((c) => c.member.name)).toEqual(["Cara"]);
    expect(ranked.unavailable.map((c) => c.member.name)).toEqual(["Bob"]);
  });

  it("orders within a group by fewest upcoming turns, then by name", () => {
    const target = shift({ due_on: "2026-09-16" });
    const busyCara = shift({ due_on: "2026-09-28", assigned_member: { id: 3, name: "Cara" } });
    const busyCaraToo = shift({ due_on: "2026-10-05", assigned_member: { id: 3, name: "Cara" } });

    const ranked = rankCoverCandidates(
      target,
      schedule(
        [person(ME, "Alice"), person(4, "Dana"), person(2, "Bob"), person(3, "Cara")],
        [target, busyCara, busyCaraToo],
      ),
    );

    // Bob and Dana both have nothing upcoming, so they sort by name; Cara has two.
    expect(ranked.free.map((c) => c.member.name)).toEqual(["Bob", "Dana", "Cara"]);
    expect(ranked.free.map((c) => c.upcomingCount)).toEqual([0, 0, 2]);
  });

  it("does not count the shift being handed off against anyone", () => {
    // Bob is covering the very shift being passed on; it must not make him look busy.
    const target = shift({
      due_on: "2026-09-16",
      assigned_member: { id: 3, name: "Cara" },
      covering_member: { id: 2, name: "Bob" },
    });

    const ranked = rankCoverCandidates(
      target,
      schedule([person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")], [target]),
    );

    expect(ranked.free.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.free[0].upcomingCount).toBe(0);
  });

  it("returns four empty groups in a one-member house", () => {
    const target = shift({ due_on: "2026-09-16" });
    const ranked = rankCoverCandidates(target, schedule([person(ME, "Alice")], [target]));

    expect(ranked).toEqual({ free: [], busy: [], away: [], unavailable: [] });
  });
});

// BLO-1667. The house calendar's away entries, which sit between "has a shift that
// week" and "can't be texted": still a real ask, just the last one you would make.
describe("rankCoverCandidates with a house calendar", () => {
  const house = [person(ME, "Alice"), person(2, "Bob"), person(3, "Cara")];

  it("moves housemates who are away on the due date into an Away group", () => {
    const target = shift({ due_on: "2026-09-23" }); // Wed
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule(house, [target]), [
        // Bob is on a trip that covers the 23rd; Cara leaves the day after it.
        awayEvent({
          title: "Bob in Greece",
          starts_on: "2026-09-20",
          ends_on: "2026-09-24",
          member_ids: [2],
        }),
        awayEvent({
          title: "Cara in France",
          starts_on: "2026-09-24",
          ends_on: "2026-09-26",
          member_ids: [3],
        }),
      ]),
    );

    expect(ranked.away.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.free.map((c) => c.member.name)).toEqual(["Cara"]);
    expect(ranked.busy).toEqual([]);
  });

  it("keeps away housemates selectable, because the trip may have ended early", () => {
    const target = shift({ due_on: "2026-09-23" });
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule([person(ME, "Alice"), person(2, "Bob", false), person(3, "Cara")], [target]), [
        awayEvent({ title: "Cara in France", member_ids: [3] }),
      ]),
    );

    expect(selectableCandidates(ranked).map((c) => c.member.name)).toEqual(["Cara"]);
    expect(ranked.unavailable.map((c) => c.member.name)).toEqual(["Bob"]);
  });

  it("names the trip and how long it runs as the reason", () => {
    const target = shift({ due_on: "2026-09-23" });
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule(house, [target]), [
        awayEvent({
          title: "Bob in Greece",
          starts_on: "2026-09-20",
          ends_on: "2026-09-24",
          member_ids: [2],
        }),
        awayEvent({ title: "Cara at her mum's", member_ids: [3] }),
      ]),
    );

    expect(ranked.away.map((c) => c.reason)).toEqual([
      "Bob in Greece · until Thu 24 Sept",
      "Cara at her mum's",
    ]);
  });

  it("leaves the other groups without a reason", () => {
    const target = shift({ due_on: "2026-09-23" });
    const ranked = rankCoverCandidates(target, schedule(house, [target]));

    expect(ranked.free.map((c) => c.reason)).toEqual([undefined, undefined]);
  });

  it("ignores entries that are not away, however long they run", () => {
    const target = shift({ due_on: "2026-09-23" });
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule(house, [target]), [
        awayEvent({
          title: "Kitchen refit",
          kind: "event",
          starts_on: "2026-09-21",
          ends_on: "2026-09-28",
          member_ids: [2, 3],
        }),
      ]),
    );

    expect(ranked.away).toEqual([]);
    expect(ranked.free.map((c) => c.member.name)).toEqual(["Bob", "Cara"]);
  });

  it("still counts someone who can't be texted as unavailable, not away", () => {
    // "Can't be texted" is the harder stop: a trip might have ended, an opt-out has not.
    const target = shift({ due_on: "2026-09-23" });
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule([person(ME, "Alice"), person(2, "Bob", false)], [target]), [
        awayEvent({ title: "Bob in Greece", member_ids: [2] }),
      ]),
    );

    expect(ranked.away).toEqual([]);
    expect(ranked.unavailable.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.unavailable[0].reason).toBeUndefined();
  });

  it("orders the Away group by fewest upcoming turns, then by name", () => {
    const target = shift({ due_on: "2026-09-23" });
    const busyBob = shift({ due_on: "2026-10-07", assigned_member: { id: 2, name: "Bob" } });
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule([...house, person(4, "Dana")], [target, busyBob]), [
        awayEvent({ title: "House trip", member_ids: [2, 3, 4] }),
      ]),
    );

    expect(ranked.away.map((c) => c.member.name)).toEqual(["Cara", "Dana", "Bob"]);
    expect(ranked.away.map((c) => c.upcomingCount)).toEqual([0, 0, 1]);
  });

  it("deprioritises an away housemate who also has a shift that week", () => {
    // Away wins over busy: the sheet must show each person exactly once.
    const target = shift({ due_on: "2026-09-23" });
    const bobsSameWeek = shift({
      due_on: "2026-09-25",
      rota_name: "Bins",
      assigned_member: { id: 2, name: "Bob" },
    });
    const ranked = rankCoverCandidates(
      target,
      withEvents(schedule(house, [target, bobsSameWeek]), [
        awayEvent({ title: "Bob in Greece", member_ids: [2] }),
      ]),
    );

    expect(ranked.away.map((c) => c.member.name)).toEqual(["Bob"]);
    expect(ranked.busy).toEqual([]);
    expect(ranked.away[0].weekShifts.map((s) => s.rota_name)).toEqual(["Bins"]);
  });
});
