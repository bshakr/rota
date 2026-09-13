import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";
import { formatDayNumber, formatMonthShort } from "@/lib/date";
import { addCivilDays, civilDate, compareCivil } from "@/lib/group-dates";

import type { FeedEvent } from "./calendar-view";
import { toFeedEvent } from "./calendar-view";

// The member feed's view model, as pure functions. Everything the page decides about
// WHICH shifts appear and HOW they are grouped lives here, alone and tested, because
// it is the only real logic on an otherwise presentational screen and because it has
// to hold after a cover mutation returns a fresh shift, not just on first load.
//
// Every date here is a CIVIL date (YYYY-MM-DD) and every comparison goes through
// group-dates.ts. The reference "today" is always the one the API sent — the GROUP's
// calendar date — never the browser clock and never the app-wide TIME_ZONE constant.
// A London house provisioned as UTC must not have its week boundary an hour out.

/** How the feed is narrowed by rota. `me` is "any shift I'm on", across every rota. */
export type RotaFilter =
  | { kind: "everyone" }
  | { kind: "me" }
  | { kind: "rota"; rotaId: number };

/**
 * The feed's whole filter state. The two halves combine with AND and clear
 * independently: tapping "Everyone" clears the rota half, tapping the selected
 * avatar clears the person half.
 */
export interface FeedFilter {
  rota: RotaFilter;
  /** A housemate the feed is narrowed to, or null for the whole house. */
  personId: number | null;
}

/** The default: the whole house, every rota. */
export const ALL_SHIFTS: FeedFilter = { rota: { kind: "everyone" }, personId: null };

/** One calendar day inside a week section, with everything due that day. */
export interface DayRow {
  due_on: string;
  shifts: MemberShift[];
  /**
   * House calendar entries that BEGIN this day — a trip, a dinner. Always present
   * and often empty, so a row never has to ask whether a calendar is connected.
   */
  events: FeedEvent[];
}

/** One week of the feed: a Monday, a human label, and the days that have shifts. */
export interface WeekSection {
  /** The Monday of this week, as a civil date. */
  weekStart: string;
  label: string;
  days: DayRow[];
}

/**
 * The Monday of the week containing `civil`, as a civil date.
 *
 * Weeks run Monday to Sunday. `getUTCDay` is safe here because `civilDate` pins the
 * instant to NOON UTC, so the UTC weekday is the calendar weekday in every real zone.
 */
export function weekStart(civil: string): string {
  const weekday = civilDate(civil).getUTCDay(); // 0 = Sunday
  return addCivilDays(civil, -(weekday === 0 ? 6 : weekday - 1));
}

/**
 * What a week section is called. The week containing today is "This week" even when
 * today is a Sunday — in which case the section holds only today, since nothing
 * earlier is ever rendered.
 */
export function weekLabel(start: string, today: string): string {
  const current = weekStart(today);
  if (start === current) return "This week";
  if (start === addCivilDays(current, 7)) return "Next week";
  return weekRangeLabel(start);
}

// "5-11 Oct" when the week sits inside one month, "28 Sep - 4 Oct" when it straddles
// two (a new year included: "28 Dec - 3 Jan"). The dashes are en dashes, spaced only
// in the straddling form, which is how the spec writes them.
function weekRangeLabel(start: string): string {
  const from = civilDate(start);
  const to = civilDate(addCivilDays(start, 6));
  const fromMonth = formatMonthShort(from);
  const toMonth = formatMonthShort(to);

  return fromMonth === toMonth
    ? `${formatDayNumber(from)}–${formatDayNumber(to)} ${toMonth}`
    : `${formatDayNumber(from)} ${fromMonth} – ${formatDayNumber(to)} ${toMonth}`;
}

/**
 * Does this member have a stake in this shift? True for the person the rota assigned
 * it to AND for whoever is covering — deliberately broader than "responsible", because
 * someone who handed a shift away must still see it to take it back.
 */
export function shiftInvolves(shift: MemberShift, memberId: number): boolean {
  return shift.assigned_member.id === memberId || shift.covering_member?.id === memberId;
}

/** Whether one shift survives the current filter. The two halves combine with AND. */
export function matchesFilter(shift: MemberShift, filter: FeedFilter, viewerId: number): boolean {
  if (filter.rota.kind === "me" && !shiftInvolves(shift, viewerId)) return false;
  if (filter.rota.kind === "rota" && shift.rota_id !== filter.rota.rotaId) return false;
  if (filter.personId !== null && !shiftInvolves(shift, filter.personId)) return false;
  return true;
}

// One comparator for every ordering on this page: by day, then by rota name so two
// jobs due the same day always read in the same order, then by id so it is total.
function byDayThenRota(a: MemberShift, b: MemberShift): number {
  return (
    compareCivil(a.due_on, b.due_on) || a.rota_name.localeCompare(b.rota_name) || a.id - b.id
  );
}

function upcoming(schedule: MemberScheduleResponse): MemberShift[] {
  return schedule.shifts
    .filter((shift) => compareCivil(shift.due_on, schedule.today) >= 0)
    .sort(byDayThenRota);
}

/**
 * Whether the house calendar shows through the current filter.
 *
 * A rota chip means "just the bins, please", and a trip belongs to no rota — so the
 * chips hide events entirely rather than showing a bin day under a heading that says
 * otherwise. "Everyone" and "Just me" both show them (spec section 9): a trip is as
 * much a part of your own week as your turns are.
 *
 * The PERSON half is deliberately not consulted. It narrows who the shifts are about,
 * and what the house is doing stays true whoever you are looking at — the day you
 * pick someone to ask is exactly the day you need to see they are in Greece.
 */
function showsEvents(filter: FeedFilter): boolean {
  return filter.rota.kind !== "rota";
}

/**
 * House calendar entries that begin today or later, as feed rows keyed by their day.
 *
 * An entry already under way when the payload was built has no row of its own: the
 * feed only ever renders forwards, and a trip that started on Friday would otherwise
 * reappear above today every time the page loaded. Who is away RIGHT NOW is answered
 * by `awayMemberIdsOn` on the people strip, which reads the whole range.
 */
function eventsByDay(schedule: MemberScheduleResponse): Map<string, FeedEvent[]> {
  const days = new Map<string, FeedEvent[]>();

  for (const event of schedule.events) {
    if (compareCivil(event.starts_on, schedule.today) < 0) continue;
    const day = days.get(event.starts_on);
    const feedEvent = toFeedEvent(event, schedule.members);
    if (day) day.push(feedEvent);
    else days.set(event.starts_on, [feedEvent]);
  }

  return days;
}

/**
 * The whole feed: week sections, each holding the days that have shifts or house
 * calendar entries.
 *
 * Weeks and days with nothing in them are omitted rather than rendered empty, so a
 * fortnightly rota does not leave a blank card every other week — but a day carrying
 * only a trip IS a day worth rendering, which is why the days are assembled from both
 * sources rather than walked off the shifts alone. Past shifts and past entries are
 * dropped here as well as on the server: the function is then total, and a stale
 * payload after midnight cannot render yesterday.
 */
export function buildFeed(schedule: MemberScheduleResponse, filter: FeedFilter): WeekSection[] {
  const shiftDays = new Map<string, MemberShift[]>();
  for (const shift of upcoming(schedule)) {
    if (!matchesFilter(shift, filter, schedule.member.id)) continue;
    const day = shiftDays.get(shift.due_on);
    if (day) day.push(shift);
    else shiftDays.set(shift.due_on, [shift]);
  }

  const eventDays = showsEvents(filter) ? eventsByDay(schedule) : new Map<string, FeedEvent[]>();
  const dates = [...new Set([...shiftDays.keys(), ...eventDays.keys()])].sort(compareCivil);

  const weeks: WeekSection[] = [];
  for (const due_on of dates) {
    const start = weekStart(due_on);
    let week = weeks.at(-1);
    if (!week || week.weekStart !== start) {
      week = { weekStart: start, label: weekLabel(start, schedule.today), days: [] };
      weeks.push(week);
    }
    week.days.push({
      due_on,
      shifts: shiftDays.get(due_on) ?? [],
      events: eventDays.get(due_on) ?? [],
    });
  }

  return weeks;
}

/**
 * The upcoming turns a person is actually on the hook for, in order. Defaults to the
 * viewer. A shift they have handed away is NOT here — it is no longer theirs to do,
 * even though the feed still shows it with a "Take it back".
 */
export function responsibleShifts(
  schedule: MemberScheduleResponse,
  memberId: number = schedule.member.id,
): MemberShift[] {
  return upcoming(schedule).filter((shift) => shift.responsible_member.id === memberId);
}

/**
 * Each housemate's next turn, keyed by member id. Keyed on who is RESPONSIBLE, so a
 * covered shift counts for the cover and not for the original assignee: "what is Bob
 * next down for" has to mean what Bob will actually do.
 */
export function nextShiftByMember(schedule: MemberScheduleResponse): Map<number, MemberShift> {
  const next = new Map<number, MemberShift>();
  for (const shift of upcoming(schedule)) {
    const id = shift.responsible_member.id;
    if (!next.has(id)) next.set(id, shift);
  }
  return next;
}

/**
 * What the next-shift card leads with. Three cases, decided here rather than inside
 * the card, because the phone and the desktop sidebar render the same card twice and
 * the third case is easy to get wrong:
 *
 *   shift       their own next turn, with the two after it named underneath.
 *   handed-off  they are down for nothing, but a turn they gave away is still coming.
 *               "Nothing on your plate" alone would be a lie by omission the moment
 *               they hand off the only thing they had, and it is the only confirmation
 *               they get when that shift sits past the weeks the feed renders.
 *   nothing     genuinely nothing, which is a reassurance and not an error.
 */
export type NextUp =
  | { kind: "shift"; shift: MemberShift; then: MemberShift[] }
  | { kind: "handed-off"; shift: MemberShift; to: string }
  | { kind: "nothing" };

/** How many further turns the card names in its "Then …" line. */
const THEN_LIMIT = 2;

/**
 * Which of the three the card shows, for the viewer or for any member.
 *
 * A turn they are responsible for always wins: a handed-off shift is somebody else's
 * problem now, so it can only be the lead when there is nothing else to lead with.
 */
export function nextUp(
  schedule: MemberScheduleResponse,
  memberId: number = schedule.member.id,
): NextUp {
  const [next, ...rest] = responsibleShifts(schedule, memberId);
  if (next) return { kind: "shift", shift: next, then: rest.slice(0, THEN_LIMIT) };

  // Soonest first, because `upcoming` is already ordered — the one they will be asked
  // about is the one arriving next.
  for (const shift of upcoming(schedule)) {
    const to = shift.covering_member;
    if (to && shift.assigned_member.id === memberId) {
      return { kind: "handed-off", shift, to: to.name };
    }
  }

  return { kind: "nothing" };
}
