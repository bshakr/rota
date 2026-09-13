import type { MemberRef, MemberShift } from "@/lib/api/types";

// The one pure decision the member page makes about a shift: what is this to ME?
// It lived alongside the old shift card; the card is going and the feed asks the same
// question for every row, so the vocabulary lives here with the function now.

/**
 * What a member's relationship to one shift is.
 *
 *   yours       your turn, nobody covering.
 *   handed-off  you gave this turn away, and can take it back.
 *   covering    you took someone else's turn, so "why am I down for the bins?"
 *               has an answer on the row itself.
 */
export type ShiftState =
  | { kind: "yours" }
  | { kind: "handed-off"; to: string }
  | { kind: "covering"; forName: string };

/**
 * Which state this member sees for one shift, or `null` when the shift does not
 * concern them at all — which, on a whole-house feed, is most of them. A `null` row
 * is still rendered; it just carries no YOU tag and no action.
 */
export function shiftStateFor(shift: MemberShift, memberId: number): ShiftState | null {
  const iAmAssignee = shift.assigned_member.id === memberId;
  const iAmCovering = shift.covering_member?.id === memberId;

  if (iAmAssignee) {
    return shift.covering_member
      ? { kind: "handed-off", to: shift.covering_member.name }
      : { kind: "yours" };
  }
  if (iAmCovering) {
    return { kind: "covering", forName: shift.assigned_member.name };
  }
  return null;
}

/**
 * Who this member can hand a given shift to. `coverable_members` already excludes the
 * member themselves (the API resolves it); this drops the shift's original assignee
 * too, since offering them their own shift back is the `already_assignee` rejection.
 *
 * SUPERSEDED by rankCoverCandidates in ./cover-ranking, which answers the same question
 * from the whole-house schedule and groups the answer by who is actually free. This
 * stays only because ./shift-list.tsx, the last caller, is deleted in the integration
 * step; delete this function and its describe block in shift-view.test.ts with it.
 */
export function coverTargetsFor(shift: MemberShift, coverable: MemberRef[]): MemberRef[] {
  return coverable.filter((member) => member.id !== shift.assigned_member.id);
}
