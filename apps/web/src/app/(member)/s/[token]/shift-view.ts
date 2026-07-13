import type { ShiftState } from "@/components/member/shift-card";
import type { MemberRef, MemberShift } from "@/lib/api/types";

// The member page assembled from the shift-card vocabulary. Two pure decisions the
// list makes for every shift live here — alone and tested — because they are the
// only logic on an otherwise presentational screen, and because they must hold
// after a cover mutation returns a fresh shift, not just on first load.

/**
 * Which of the shift-card's three states this member sees for one shift, or `null`
 * when the shift no longer concerns them.
 *
 * The `null` case is real and easy to miss: when someone who was *covering* a shift
 * hands it on to a third person, the returned shift lists neither them as assignee
 * nor as cover, so it drops off their list — exactly what a fresh reload would do.
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
 * Who this member can hand a given shift to. `coverable_members` already excludes
 * the member themselves (the API resolves it); this drops the shift's original
 * assignee too, since offering them their own shift back is the `already_assignee`
 * rejection — so the page never presents a name the API would refuse.
 */
export function coverTargetsFor(shift: MemberShift, coverable: MemberRef[]): MemberRef[] {
  return coverable.filter((member) => member.id !== shift.assigned_member.id);
}
