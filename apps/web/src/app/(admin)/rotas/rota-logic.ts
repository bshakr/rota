import type { IntervalUnit, RotaPositionEntry } from "@/lib/api/types";
import { TIME_ZONE } from "@/lib/date";

// Pure rota logic, kept out of the components so it can be unit-tested in a plain
// node runner (no DOM). Two things live here:
//
//   1. Small label helpers the editor and the list both need, so "on the day" and
//      "Every 2 weeks" are spelled the same on every screen.
//   2. The next-N-shifts PROJECTION. It has to mirror the Rails ShiftGenerator's
//      date math exactly, because its whole job is to show the admin who lands
//      where BEFORE saving — a projection that disagrees with what the backend
//      then generates would be worse than none. See apps/api ShiftGenerator.

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * A reminder offset is a number of days before a shift. Offset `0` is the day
 * itself and MUST read "on the day" — never "0 days before", which is the bug the
 * ticket calls out by name.
 */
export function reminderOffsetLabel(days: number): string {
  if (days === 0) return "on the day";
  return `${days} ${days === 1 ? "day" : "days"} before`;
}

/** Longest lead first, day-of last — the order a reminder timeline reads in. */
export function sortOffsetsDesc(offsets: number[]): number[] {
  return [...offsets].sort((a, b) => b - a);
}

/** "Every day" / "Every 2 weeks" — the recurrence in plain words, for cards and headers. */
export function scheduleLabel(count: number, unit: IntervalUnit): string {
  if (count === 1) return `Every ${unit}`;
  return `Every ${count} ${unit}s`;
}

/** The send hour as a zero-padded 24-hour clock, e.g. 9 → "09:00". */
export function sendHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

// ---------------------------------------------------------------------------
// Civil dates
// ---------------------------------------------------------------------------

/** A calendar day with no time and no zone — what `starts_on` and `due_on` are. */
export interface CivilDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

export function parseDayString(iso: string): CivilDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function formatDayString({ year, month, day }: CivilDate): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

// A civil day rendered in the pinned timezone. en-CA gives YYYY-MM-DD, which is
// also our wire format, so this doubles as "the current day in Europe/London".
const dayStringFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Turn a `YYYY-MM-DD` day into a `Date` for the Calendar (`selected`) and for
 * `@/lib/date` formatters. Noon UTC is deliberate: TIME_ZONE is Europe/London
 * (never a negative UTC offset), so noon UTC is always the same civil day when
 * read back in that zone — no off-by-one at the day boundary. If the product ever
 * pins a west-of-UTC zone this needs revisiting (BLO-1053 threads group tz).
 */
export function dayStringToDisplayDate(iso: string): Date {
  const { year, month, day } = parseDayString(iso);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/**
 * The inverse for a `Date` coming out of the Calendar's `onSelect`. Reads the
 * civil day AS SEEN in TIME_ZONE (via Intl), so it is correct whether the picker
 * hands back a zoned or a plain Date.
 */
export function displayDateToDayString(date: Date): string {
  return dayStringFormatter.format(date);
}

/** Today's civil date in the pinned timezone — the anchor for "skip past shifts". */
export function todayDayString(now: Date = new Date()): string {
  return dayStringFormatter.format(now);
}

// ---------------------------------------------------------------------------
// Shift projection
// ---------------------------------------------------------------------------

export interface ProjectedShift {
  dueOn: string;
  /** The member the rota assigns to this occurrence, by position wrap. */
  member: RotaPositionEntry;
}

export interface ProjectShiftsOptions {
  startsOn: string;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  /** The roster in rotation order. Empty means a draft rota: nothing is generated. */
  roster: RotaPositionEntry[];
  /** How many upcoming shifts to return. */
  count: number;
  /** Skip occurrences before this civil day (defaults to no skipping). */
  fromDay?: string;
}

// A hard ceiling on the exponential search for the first upcoming occurrence, so
// a pathological input can never loop unbounded. 2^40 occurrences is astronomically
// past any real rota; the search reaches it in 40 steps.
const MAX_INDEX = 2 ** 40;

/**
 * The next `count` shifts a rota would generate, mirroring the Rails generator:
 * occurrence *i* falls on `startsOn + i * intervalCount` of the unit, and its
 * assignee is `roster[i % roster.length]` — the wrap-around is the rotation.
 *
 * The assignee tracks the TRUE occurrence index, so skipping past shifts with
 * `fromDay` never shifts who is up next. The first upcoming index is found by
 * search rather than a linear scan, so an old rota (a daily one started years
 * ago) still projects its real upcoming shifts instead of running off a cap.
 */
export function projectShifts({
  startsOn,
  intervalCount,
  intervalUnit,
  roster,
  count,
  fromDay,
}: ProjectShiftsOptions): ProjectedShift[] {
  if (roster.length === 0 || count <= 0) return [];

  const start = parseDayString(startsOn);
  const dayAt = (i: number) => formatDayString(addInterval(start, i * intervalCount, intervalUnit));

  const startIndex = fromDay ? firstIndexOnOrAfter(dayAt, fromDay) : 0;

  const shifts: ProjectedShift[] = [];
  for (let k = 0; k < count; k++) {
    const i = startIndex + k;
    shifts.push({ dueOn: dayAt(i), member: roster[i % roster.length] });
  }
  return shifts;
}

// Occurrence dates strictly increase with the index, so "first index whose day is
// >= fromDay" is a monotonic predicate: exponential-probe an upper bound, then
// binary-search. Lexicographic comparison is correct for zero-padded YYYY-MM-DD.
function firstIndexOnOrAfter(dayAt: (i: number) => string, fromDay: string): number {
  if (dayAt(0) >= fromDay) return 0;

  let hi = 1;
  while (hi < MAX_INDEX && dayAt(hi) < fromDay) hi *= 2;

  let lo = Math.floor(hi / 2);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayAt(mid) < fromDay) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addInterval(from: CivilDate, amount: number, unit: IntervalUnit): CivilDate {
  if (unit === "day") return addDays(from, amount);
  if (unit === "week") return addDays(from, amount * 7);
  return addMonths(from, amount);
}

// UTC arithmetic so day counting is timezone-neutral and deterministic in tests.
function addDays({ year, month, day }: CivilDate, amount: number): CivilDate {
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + amount);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

// Month steps clamp to the end of a short target month (31 Jan + 1 → 28/29 Feb),
// matching ActiveSupport's `n.months` and therefore the Rails generator.
function addMonths({ year, month, day }: CivilDate, amount: number): CivilDate {
  const zeroBased = month - 1 + amount;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12; // 0–11
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return { year: targetYear, month: targetMonth + 1, day: Math.min(day, lastDay) };
}
