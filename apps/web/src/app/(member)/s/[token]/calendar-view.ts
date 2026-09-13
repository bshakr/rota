import type { CalendarEventItem, CalendarEventKind, ScheduleMember } from "@/lib/api/types";
import { formatShiftDate } from "@/lib/date";
import { civilDate, compareCivil } from "@/lib/group-dates";

// The house calendar, reduced to what the member feed renders. Pure functions, for
// the same reason schedule-view.ts is: this is the only real logic on a screen that
// is otherwise presentation, and "who is away on a Tuesday" is the kind of inclusive
// range arithmetic that is wrong far more often than it looks.
//
// Every date here is a CIVIL date (YYYY-MM-DD) in the group's calendar and every
// comparison goes through group-dates.ts. `lib/date.ts` formats INSTANTS, so a civil
// date is handed to it through `civilDate`, which pins it to noon UTC, so no
// formatter can then land on the day before or after.
//
// A calendar entry's `starts_on`/`ends_on` are INCLUSIVE of both ends: a trip that
// reads 25 Sept to 1 Oct covers the 1st, and someone is home again on the 2nd.

/** One calendar entry as a feed row says it. */
export interface FeedEvent {
  id: number;
  title: string;
  kind: CalendarEventKind;
  /** "19:00" for timed entries, null for all-day. */
  timeLabel: string | null;
  /** "until Thu 1 Oct" for multi-day entries, null for single-day. */
  untilLabel: string | null;
  /** The housemates the entry is about, in the order the API named them. */
  memberNames: string[];
}

/**
 * Entries that BEGIN on this civil date.
 *
 * A multi-day trip appears once, on its first day, rather than on each day it spans:
 * a fortnight in Greece would otherwise bury two weeks of the rota under fourteen
 * identical rows. How long it runs is carried by the row's "until" label instead, and
 * "who is away right now" is answered by `awayMemberIdsOn`, not by the rows.
 */
export function eventsStartingOn(events: CalendarEventItem[], date: string): CalendarEventItem[] {
  return events.filter((event) => event.starts_on === date);
}

/**
 * Ids of housemates with an away entry covering this civil date, ascending.
 *
 * Both ends are inclusive, and a person counts once however many trips overlap. Only
 * `away` entries count: a house dinner that runs a week is still a thing happening
 * HERE, and marking everyone away for it would be a lie the hand-off sheet acts on.
 */
export function awayMemberIdsOn(events: CalendarEventItem[], date: string): number[] {
  const ids = new Set<number>();

  for (const event of events) {
    if (event.kind !== "away") continue;
    if (compareCivil(event.starts_on, date) > 0) continue;
    if (compareCivil(event.ends_on, date) < 0) continue;
    for (const id of event.member_ids) ids.add(id);
  }

  return [...ids].sort((a, b) => a - b);
}

/** "until Thu 1 Oct" for an entry that spans days, null for one that does not. */
export function eventRangeLabel(event: CalendarEventItem): string | null {
  if (event.ends_on === event.starts_on) return null;
  return `until ${formatShiftDate(civilDate(event.ends_on))}`;
}

/**
 * "Bass and Ciara away": how an away row names the people it is about.
 *
 * The API matches a calendar title to housemates and can legitimately match none (a
 * trip nobody in the house is on, or a name it could not resolve). "away" on its own
 * would then name nobody, so the row falls back to the words the calendar itself
 * used, which is the only information left that is true.
 */
export function awayLabel(event: CalendarEventItem, members: ScheduleMember[]): string {
  return awayText(memberNames(event, members), event.title);
}

/** One calendar entry as the feed needs it: labels resolved, ids already looked up. */
export function toFeedEvent(event: CalendarEventItem, members: ScheduleMember[]): FeedEvent {
  return {
    id: event.id,
    title: event.title,
    kind: event.kind,
    // All-day wins over `start_time`: an all-day entry with a time on it is a
    // midnight artefact of the source calendar, not something to print at a member.
    timeLabel: event.all_day ? null : event.start_time,
    untilLabel: eventRangeLabel(event),
    memberNames: memberNames(event, members),
  };
}

/**
 * What a feed row leads with: "{names} away" for a trip, the title for anything else.
 *
 * Away rows are NORMALISED rather than quoted, because a calendar's own wording is
 * whatever its owner typed ("AC OOO", "🏝️") and the one thing the house needs off it
 * is which housemate is not here. `eventMetaLabel` carries the rest of the line.
 */
export function eventRowLabel(event: FeedEvent): string {
  return event.kind === "away" ? awayText(event.memberNames, event.title) : event.title;
}

/**
 * The quiet half of a feed row, after the "·": when it is, or how long it runs.
 *
 * Time beats range, because "19:00" is the thing you plan around and a dinner that
 * spills past midnight is still Thursday's dinner.
 */
export function eventMetaLabel(event: FeedEvent): string | null {
  return event.timeLabel ?? event.untilLabel;
}

function awayText(names: string[], fallback: string): string {
  return names.length === 0 ? fallback : `${joinNames(names)} away`;
}

function memberNames(event: CalendarEventItem, members: ScheduleMember[]): string[] {
  return event.member_ids
    .map((id) => members.find((member) => member.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

/** "Bass", "Bass and Ciara", "Bass, Ciara and Alfie": the house's own plain English. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
