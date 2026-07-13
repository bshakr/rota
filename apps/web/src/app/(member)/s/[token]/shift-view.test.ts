import { describe, expect, it } from "vitest";

import type { MemberRef, MemberShift } from "@/lib/api/types";

import { coverTargetsFor, shiftStateFor } from "./shift-view";

// The member is always id 1 ("me") in these fixtures; everyone else is a housemate.
const ME = 1;

function ref(id: number, name: string): MemberRef {
  return { id, name };
}

function shift(partial: Partial<MemberShift> = {}): MemberShift {
  const assigned = partial.assigned_member ?? ref(ME, "Alice");
  const covering = partial.covering_member ?? null;
  return {
    id: 100,
    rota_id: 1,
    rota_name: "Kitchen",
    due_on: "2026-07-20",
    covered: covering !== null,
    assigned_member: assigned,
    covering_member: covering,
    responsible_member: covering ?? assigned,
    can_assign_cover: false,
    can_cancel_cover: false,
    ...partial,
  };
}

describe("shiftStateFor", () => {
  it("is 'yours' when I'm the assignee and no one is covering", () => {
    const state = shiftStateFor(shift({ assigned_member: ref(ME, "Alice") }), ME);
    expect(state).toEqual({ kind: "yours" });
  });

  it("is 'handed-off' when I'm the assignee and someone else is covering", () => {
    const state = shiftStateFor(
      shift({ assigned_member: ref(ME, "Alice"), covering_member: ref(2, "Bob") }),
      ME,
    );
    expect(state).toEqual({ kind: "handed-off", to: "Bob" });
  });

  it("is 'covering' when I took someone else's shift", () => {
    const state = shiftStateFor(
      shift({ assigned_member: ref(2, "Bob"), covering_member: ref(ME, "Alice") }),
      ME,
    );
    expect(state).toEqual({ kind: "covering", forName: "Bob" });
  });

  it("is null when the shift no longer involves me — e.g. I handed on a shift I was covering", () => {
    // Assigned to Bob, now covered by Cara. Alice (me) is neither.
    const state = shiftStateFor(
      shift({ assigned_member: ref(2, "Bob"), covering_member: ref(3, "Cara") }),
      ME,
    );
    expect(state).toBeNull();
  });
});

describe("coverTargetsFor", () => {
  const coverable = [ref(2, "Bob"), ref(3, "Cara"), ref(4, "Dev")];

  it("offers every coverable member for my own uncovered shift", () => {
    const targets = coverTargetsFor(shift({ assigned_member: ref(ME, "Alice") }), coverable);
    expect(targets).toEqual(coverable);
  });

  it("excludes the original assignee when I'm handing on a shift I'm covering", () => {
    // I (Alice) am covering Bob's shift; offering Bob back would be rejected as already_assignee.
    const targets = coverTargetsFor(
      shift({ assigned_member: ref(2, "Bob"), covering_member: ref(ME, "Alice") }),
      coverable,
    );
    expect(targets).toEqual([ref(3, "Cara"), ref(4, "Dev")]);
  });
});
