import type {
  CalendarEventItem,
  MemberScheduleResponse,
  MemberShift,
  ScheduleMember,
} from "@/lib/api/types";
import { awayMemberIdsOn, eventRangeLabel } from "@/lib/calendar-view";

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
  /**
   * Why this person was pushed down the list, in the house's own words: "Bob in
   * Greece · until Thu 24 Sept". Only `away` candidates carry one, because the other
   * groups are explained by their heading and by `weekShifts`.
   */
  reason?: string;
}

/**
 * The four groups the hand-off sheet renders, in this order. `unavailable` is listed
 * but not selectable: an opted-out housemate still lives here, and hiding them reads
 * as "they don't exist" rather than "we can't text them".
 *
 * `away` sits between `busy` and `unavailable` because it is a softer stop than either
 * of its neighbours reads: someone on a trip is a worse ask than someone with the bins
 * on Friday, but they can still be asked.
 */
export interface CoverCandidates {
  free: CoverCandidate[];
  busy: CoverCandidate[];
  away: CoverCandidate[];
  unavailable: CoverCandidate[];
}

/**
 * The groups you can actually hand the shift to. `away` is one of them ON PURPOSE:
 * the calendar is a guess about a future day, the person looking at the sheet may know
 * the trip was cut short, and only they can weigh that. Nothing but `unavailable` is
 * out, because that one is not a judgement call: we have no way to text them.
 */
export const SELECTABLE_GROUPS = ["free", "busy", "away"] as const;

/** Everyone the sheet will let you pick, in the order it renders them. */
export function selectableCandidates(ranked: CoverCandidates): CoverCandidate[] {
  return SELECTABLE_GROUPS.flatMap((group) => ranked[group]);
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

  // One pre-flight pass over the calendar, before anyone is grouped: who is away on
  // the day the shift falls, and which entry to blame. Never per candidate, and never
  // as a side effect inside a `.filter` predicate.
  const awayOn = awayEventsOn(schedule.events ?? [], shift.due_on);

  // `contactable` is decided first and separately. "Can't be texted" is the harder
  // stop of the two: a trip may have ended early, an opt-out has not.
  const contactable = candidates.filter((c) => c.member.contactable);
  const here = contactable.filter((c) => !awayOn.has(c.member.id));

  return {
    free: here.filter((c) => c.weekShifts.length === 0).sort(byLoadThenName),
    busy: here.filter((c) => c.weekShifts.length > 0).sort(byLoadThenName),
    away: contactable
      .flatMap((c) => {
        const event = awayOn.get(c.member.id);
        return event ? [{ ...c, reason: awayReason(event) }] : [];
      })
      .sort(byLoadThenName),
    unavailable: candidates.filter((c) => !c.member.contactable).sort(byLoadThenName),
  };
}

/**
 * Each housemate away on `date`, and the entry that puts them there.
 *
 * The inclusive-range test is `awayMemberIdsOn`'s and stays there. Asking it about
 * one entry at a time is how this reads the answer back per entry without owning a
 * second copy of the arithmetic, which is the copy that would eventually disagree.
 * First entry wins: two overlapping trips is a rare enough house that naming the
 * earlier one is better than a sentence listing both.
 */
function awayEventsOn(events: CalendarEventItem[], date: string): Map<number, CalendarEventItem> {
  const found = new Map<number, CalendarEventItem>();

  for (const event of events) {
    for (const id of awayMemberIdsOn([event], date)) {
      if (!found.has(id)) found.set(id, event);
    }
  }

  return found;
}

/**
 * "Bob in Greece · until Thu 24 Sept", the reason on an away row.
 *
 * The calendar's OWN title, not the normalised "Bob away" the feed prints: the row
 * has already said the name in bold above this line, so the two things it can still
 * add are where they went and when they are back.
 */
function awayReason(event: CalendarEventItem): string {
  const range = eventRangeLabel(event);
  return range ? `${event.title} · ${range}` : event.title;
}
