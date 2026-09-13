import { enGB } from "date-fns/locale";

/**
 * The single source of truth for how Rota Monster renders a date.
 *
 * This exists because of a real bug, not as ceremony. `date.toLocaleDateString()`
 * with no locale resolves to the HOST's default: Node picks en-US and renders
 * "6/28/2026", the browser picks en-GB and renders "28/06/2026". React then
 * hydrates, sees two different strings, and throws a hydration mismatch — and
 * this product is made almost entirely of dates, so it would have surfaced on
 * the dashboard, the shift list, the SMS log and the member page alike.
 *
 * Pinning the locale is not enough, which is the second bug and the reason this
 * module no longer asks Intl for any NAME or SEPARATOR. Node's ICU and a
 * browser's ICU ship different CLDR revisions, and en-GB's short-date pattern
 * differs between them: Node renders "Sat 14 Nov", a current browser renders
 * "Sat, 14 Nov". Same locale, same zone, same instant, two strings — a hydration
 * mismatch on every date the member feed prints, and these are client
 * components. So weekday and month names come from the frozen tables below and
 * the separators are written out here, which makes every formatter a pure
 * function of the calendar date.
 *
 * Intl is still used for exactly one thing: reading the NUMERIC year, month,
 * day, hour and minute of an instant as seen in TIME_ZONE. Those are pure
 * calendar arithmetic over the IANA zone rules, identical in every engine — it
 * is only the display data that drifts.
 *
 * Never call toLocaleDateString(), toLocaleString() or format a date by hand in
 * a component — use these.
 *
 * TIME ZONE is pinned for a related reason. The Node server runs in UTC and the
 * browser in the visitor's zone; a shift instant at 23:30 UTC is already
 * "tomorrow" in London, so an unpinned formatter renders a DIFFERENT DAY on the
 * server than the client — and worse, a wrong date shown to a member.
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

// The en-GB names, frozen. These are the strings the app has always rendered on
// the server; taking them from a table rather than from CLDR is what makes the
// output identical in Node and in every browser. Note "Sept", not "Sep": that is
// en-GB's abbreviation for September and changing it would change every screen.
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// The ONE Intl call left in this module, and it asks only for numbers. `h23` so
// midnight reads 0 and not 24, and the locale is irrelevant because every part is
// read by name from formatToParts — no pattern, no separator, no CLDR string.
const zoned = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

interface ZonedParts {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  /** 0 = Sunday, derived by arithmetic rather than asked of ICU. */
  weekday: number;
  hour: number;
  minute: number;
}

/** An instant's calendar fields as seen in TIME_ZONE. Engine-independent. */
function zonedParts(date: Date): ZonedParts {
  const found: Record<string, number> = {};
  for (const { type, value } of zoned.formatToParts(date)) {
    if (type !== "literal") found[type] = Number(value);
  }
  const { year, month, day, hour, minute } = found;
  return {
    year,
    month,
    day,
    // Pure arithmetic on the civil date: Date.UTC has no locale and no zone, so
    // this weekday is the same everywhere the code runs.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    // h23 should already give 0-23; the modulo costs nothing and makes a
    // hypothetical h24 engine render "00:30" rather than "24:30".
    hour: hour % 24,
    minute,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "Sat 5 Jul" — the shift list, the dashboard, the member page. */
export const formatShiftDate = (date: Date) => {
  const { weekday, day, month } = zonedParts(date);
  return `${WEEKDAY_SHORT[weekday]} ${day} ${MONTH_SHORT[month - 1]}`;
};

/** "5" — the day number on a shift card's date coin. */
export const formatDayNumber = (date: Date) => String(zonedParts(date).day);

/** "Jul" — the month on a shift card's date coin. */
export const formatMonthShort = (date: Date) => MONTH_SHORT[zonedParts(date).month - 1];

/** "Saturday, 5 July 2026" — confirmation copy, where ambiguity costs. */
export const formatLongDate = (date: Date) => {
  const { weekday, day, month, year } = zonedParts(date);
  return `${WEEKDAY_LONG[weekday]}, ${day} ${MONTH_LONG[month - 1]} ${year}`;
};

/** "5 Jul, 09:00" — the SMS log, where the hour is the point. */
export const formatTimestamp = (date: Date) => {
  const { day, month, hour, minute } = zonedParts(date);
  return `${day} ${MONTH_SHORT[month - 1]}, ${pad(hour)}:${pad(minute)}`;
};

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

/**
 * "just now" / "5 min ago" / "2 h ago" / "yesterday": elapsed time at the
 * granularity the thing being described actually changes at.
 *
 * `relativeDay` is day-granular because a shift is due on a DATE, and that is
 * exactly wrong for something that runs every hour: a calendar swept at 09:00
 * would read "today" until midnight, so an admin pressing "Sync now" would watch
 * the line not move and conclude nothing happened.
 *
 * Under a day this is pure elapsed milliseconds, so neither a zone nor a locale
 * can change the answer. A day or more hands off to `relativeDay`, which counts
 * whole local days and says "yesterday" rather than "27 h ago". A target in the
 * future (a server clock a few seconds ahead) reads "just now" rather than a
 * negative count.
 *
 * Both arguments are explicit for the same reason `relativeDay`'s are: a
 * `Date.now()` inside a component renders one string on the server and another in
 * the browser a moment later, which is a hydration mismatch. Pass the instant the
 * server rendered at.
 */
export function relativeTime(target: Date, now: Date): string {
  const elapsed = now.getTime() - target.getTime();
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return relativeDay(target, now);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Whole calendar days from `a` to `b`, counted at midnight in TIME_ZONE. */
function wholeDaysBetween(a: Date, b: Date): number {
  const ms = midnightUtcFor(b) - midnightUtcFor(a);
  return Math.round(ms / 86_400_000);
}

// The civil (Y-M-D) date of an instant AS SEEN in TIME_ZONE, pinned back to a
// UTC midnight so day differences are exact and DST-safe.
function midnightUtcFor(date: Date): number {
  const { year, month, day } = zonedParts(date);
  return Date.UTC(year, month - 1, day);
}
