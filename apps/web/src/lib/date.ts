import { enGB } from "date-fns/locale";

/**
 * The single source of truth for how HouseRota renders a date.
 *
 * This exists because of a real bug, not as ceremony. `date.toLocaleDateString()`
 * with no locale resolves to the HOST's default: Node picks en-US and renders
 * "6/28/2026", the browser picks en-GB and renders "28/06/2026". React then
 * hydrates, sees two different strings, and throws a hydration mismatch — and
 * this product is made almost entirely of dates, so it would have surfaced on
 * the dashboard, the shift list, the SMS log and the member page alike.
 *
 * Pinning the locale in one place is the fix. Never call toLocaleDateString(),
 * toLocaleString() or format a date by hand in a component — use these.
 *
 * TIME ZONE is pinned too, and for the same reason. The Node server runs in UTC
 * and the browser in the visitor's zone; a shift instant at 23:30 UTC is already
 * "tomorrow" in London, so an unpinned formatter renders a DIFFERENT DAY on the
 * server than the client — the very hydration mismatch this module exists to
 * prevent, and worse, a wrong date shown to a member. Every formatter below pins
 * `timeZone`, so server and client always agree.
 *
 * TZ is a module constant today because the product is UK-first. A group has its
 * own `timezone` column (see the data model), and BLO-1053 will thread that
 * through so each group's dates render in its own zone; until real group data
 * exists there is nothing to thread, and a fixed zone is correct and safe.
 */
export const LOCALE = "en-GB";
export const TIME_ZONE = "Europe/London";

/** react-day-picker / date-fns want the Locale object, not the string code. */
export const DATE_LOCALE = enGB;

const shiftDate = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const longDate = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timestamp = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dayNumber = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
});

const monthShort = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  month: "short",
});

/** "Sat 5 Jul" — the shift list, the dashboard, the member page. */
export const formatShiftDate = (date: Date) => shiftDate.format(date);

/** "5" — the day number on a shift card's date coin. Pinned like the rest. */
export const formatDayNumber = (date: Date) => dayNumber.format(date);

/** "Jul" — the month on a shift card's date coin. Pinned like the rest. */
export const formatMonthShort = (date: Date) => monthShort.format(date);

/** "Saturday 5 July 2026" — confirmation copy, where ambiguity costs. */
export const formatLongDate = (date: Date) => longDate.format(date);

/** "5 Jul, 09:00" — the SMS log, where the hour is the point. */
export const formatTimestamp = (date: Date) => timestamp.format(date);

/**
 * "today" / "tomorrow" / "in 3 days" / "3 days ago" — the reassurance the member
 * page leads with, because "Sat 5 Jul" alone does not answer "is that soon?".
 *
 * Both arguments are explicit and the difference is taken in whole LOCAL days
 * (midnight to midnight in TIME_ZONE), never `Date.now()` — a shift is due on a
 * date, and "in 3 days" must not flip to "in 2 days" because the server clock is
 * six hours ahead of the reader. Pass the group's own "today" (the server knows
 * it) as the reference.
 */
export function relativeDay(target: Date, today: Date): string {
  const days = wholeDaysBetween(today, target);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${-days} days ago`;
}

/** Whole calendar days from `a` to `b`, counted at midnight in TIME_ZONE. */
function wholeDaysBetween(a: Date, b: Date): number {
  const ms = midnightUtcFor(b) - midnightUtcFor(a);
  return Math.round(ms / 86_400_000);
}

// The civil (Y-M-D) date of an instant AS SEEN in TIME_ZONE, pinned back to a
// UTC midnight so day differences are exact and DST-safe.
function midnightUtcFor(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [y, m, d] = parts.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
