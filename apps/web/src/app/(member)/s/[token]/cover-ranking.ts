import type { MemberScheduleResponse, MemberShift, ScheduleMember } from "@/lib/api/types";

import { weekStart } from "./schedule-view";

// Who is a reasonable ask. The old cover dialog was a flat list of names, which made
// every housemate look equally free; the whole point of fetching the rest of the rota
// is that the page can now say "Cara is free that week" and "Bob already has the bins
// on Friday" before anyone is texted.
//
// BLO-1667 (calendar sync) adds an `away` group HERE and nowhere else.

export interface CoverCandidate {
  member: ScheduleMember;
  /** What they are already down for in the week of the shift being handed off. */
  weekShifts: MemberShift[];
  /** How many upcoming turns they are responsible for in total. The tie-break. */
  upcomingCount: number;
}

/**
 * The three groups the hand-off sheet renders, in this order. `unavailable` is listed
 * but not selectable: an opted-out housemate still lives here, and hiding them reads
 * as "they don't exist" rather than "we can't text them".
 */
export interface CoverCandidates {
  free: CoverCandidate[];
  busy: CoverCandidate[];
  unavailable: CoverCandidate[];
}

/**
 * Rank everyone who could take `shift`.
 *
 * Two people are never offered: the viewer (handing a shift to yourself is the
 * `self_cover` rejection) and the shift's original assignee (the `already_assignee`
 * rejection). So the sheet can never present a name the API would refuse.
 *
 * The shift being handed off is excluded from everyone's own load — otherwise whoever
 * is currently covering it would be counted as busy with the very thing they are
 * trying to pass on.
 */
export function rankCoverCandidates(
  shift: MemberShift,
  schedule: MemberScheduleResponse,
): CoverCandidates {
  const week = weekStart(shift.due_on);
  const excluded = new Set([schedule.member.id, shift.assigned_member.id]);

  const candidates: CoverCandidate[] = schedule.members
    .filter((member) => !excluded.has(member.id))
    .map((member) => {
      const theirs = schedule.shifts.filter(
        (other) => other.id !== shift.id && other.responsible_member.id === member.id,
      );
      return {
        member,
        weekShifts: theirs
          .filter((other) => weekStart(other.due_on) === week)
          .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.rota_name.localeCompare(b.rota_name)),
        upcomingCount: theirs.length,
      };
    });

  // Fewest upcoming turns first, because "who has the least on" is the fair ask; name
  // breaks the tie so the order is stable between renders.
  const byLoadThenName = (a: CoverCandidate, b: CoverCandidate) =>
    a.upcomingCount - b.upcomingCount || a.member.name.localeCompare(b.member.name);

  return {
    free: candidates
      .filter((c) => c.member.contactable && c.weekShifts.length === 0)
      .sort(byLoadThenName),
    busy: candidates
      .filter((c) => c.member.contactable && c.weekShifts.length > 0)
      .sort(byLoadThenName),
    unavailable: candidates.filter((c) => !c.member.contactable).sort(byLoadThenName),
  };
}
