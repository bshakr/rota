import type { CalendarEventItem, MemberRef } from "@/lib/api/types";
import type { FeedEvent } from "@/lib/calendar-view";
import { toFeedEvent } from "@/lib/calendar-view";
import { formatDayNumber, formatMonthShort } from "@/lib/date";
import { addCivilDays, civilDate, compareCivil } from "@/lib/group-dates";

// One day of a schedule, assembled from the two things that can land on it: the turns
// that are due and the house calendar entries happening around them.
//
// This lives in lib/ because two screens build the same rows. The member feed groups
// them into week sections (schedule-view.ts) and the admin dashboard's week glance
// renders a rolling seven days of them (BLO-1686); neither should own the arithmetic,
// because a day that carries only a trip is exactly the case one of them would forget.
//
// Every date here is a CIVIL date (YYYY-MM-DD) in the group's calendar and every
// comparison goes through group-dates.ts. `lib/date.ts` formats INSTANTS, so a civil
// date reaches it through `civilDate`, pinned to noon UTC, and no formatter can then
// land on the day before or after.

/**
 * One calendar day, with everything on it.
 *
 * Generic over the shift, because the admin's `Shift` and the member's `MemberShift`
 * are different shapes and neither should be widened to suit the other. All this
 * function needs of a shift is the day it falls on.
 */
export interface DayRow<S> {
  due_on: string;
  shifts: S[];
  /**
   * House calendar entries shown on this day: a trip, a dinner. Always present and
   * often empty, so a row never has to ask whether a calendar is connected.
   */
  events: FeedEvent[];
}

/**
 * House calendar entries that have not finished, as feed rows keyed by their day.
 *
 * An entry that is already UNDER WAY lands on today rather than on the day it began.
 * The API sends these deliberately (`ends_on >= today`): a housemate who flew out last
 * Friday and is back on Thursday is away today, and that is the fact the hand-off
 * screen exists to show. Both feeds only ever render forwards, so the row cannot sit
 * above today where the trip actually started, and the "until {weekday}" label already
 * carries how much of it is left. A plain multi-day entry (guests staying, building
 * work) reaches no other surface at all, so dropping it lost it entirely.
 *
 * An entry that ENDED before today is gone, the same as a past shift.
 */
export function eventsByDay(
  events: CalendarEventItem[],
  today: string,
  members: MemberRef[],
): Map<string, FeedEvent[]> {
  const days = new Map<string, FeedEvent[]>();

  for (const event of events) {
    if (compareCivil(event.ends_on, today) < 0) continue;
    const starts = compareCivil(event.starts_on, today) < 0 ? today : event.starts_on;
    const day = days.get(starts);
    const feedEvent = toFeedEvent(event, members);
    if (day) day.push(feedEvent);
    else days.set(starts, [feedEvent]);
  }

  for (const day of days.values()) day.sort(byDayShape);

  return days;
}

// Within one day: all-day first, then by the clock, then by id so the order is total.
// An all-day entry frames the whole day — a trip, scaffolding up — so it belongs above
// the thing that happens at seven, whatever order the source calendar listed them in.
function byDayShape(a: FeedEvent, b: FeedEvent): number {
  if (a.timeLabel === null && b.timeLabel !== null) return -1;
  if (a.timeLabel !== null && b.timeLabel === null) return 1;
  if (a.timeLabel !== null && b.timeLabel !== null && a.timeLabel !== b.timeLabel) {
    // "HH:MM" is zero-padded, so lexical order is chronological.
    return a.timeLabel < b.timeLabel ? -1 : 1;
  }
  return a.id - b.id;
}

/**
 * The days of a schedule, in date order, over the UNION of the days that carry a shift
 * and the days that carry a house calendar entry.
 *
 * Walking the shifts alone would silently drop a day that holds only a trip, which is
 * one of the days most worth showing. Empty days are omitted rather than rendered
 * blank, so a fortnightly rota does not leave a hole every other week.
 *
 * The shift order inside a day is the order it was GIVEN. Both callers sort by day then
 * rota name before they get here, and re-sorting behind them would make two jobs due
 * the same day read differently here than everywhere else on the screen.
 */
export function buildDayRows<S extends { due_on: string }>(
  shifts: S[],
  eventDays: Map<string, FeedEvent[]>,
): DayRow<S>[] {
  const shiftDays = new Map<string, S[]>();
  for (const shift of shifts) {
    const day = shiftDays.get(shift.due_on);
    if (day) day.push(shift);
    else shiftDays.set(shift.due_on, [shift]);
  }

  const dates = [...new Set([...shiftDays.keys(), ...eventDays.keys()])].sort(compareCivil);

  return dates.map((due_on) => ({
    due_on,
    shifts: shiftDays.get(due_on) ?? [],
    events: eventDays.get(due_on) ?? [],
  }));
}

/**
 * "5–11 Oct" when a range sits inside one month, "28 Sept – 4 Oct" when it straddles
 * two (a new year included: "28 Dec – 3 Jan").
 *
 * The dashes are EN dashes, spaced only in the straddling form, which is how the spec
 * writes them and how the member feed has always labelled a week.
 */
export function dateRangeLabel(start: string, end: string): string {
  const from = civilDate(start);
  const to = civilDate(end);
  const fromMonth = formatMonthShort(from);
  const toMonth = formatMonthShort(to);

  return fromMonth === toMonth
    ? `${formatDayNumber(from)}–${formatDayNumber(to)} ${toMonth}`
    : `${formatDayNumber(from)} ${fromMonth} – ${formatDayNumber(to)} ${toMonth}`;
}

/**
 * What the dashboard's "Next week" section is dated. The window is rolling — today + 7
 * through today + 13 — so the label has to name the actual dates rather than a Monday
 * the reader would then have to reconcile with the glance above it.
 */
export function nextWeekRangeLabel(today: string): string {
  return dateRangeLabel(addCivilDays(today, 7), addCivilDays(today, 13));
}
