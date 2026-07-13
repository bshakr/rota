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
 * On TIME ZONES: a group has its own `timezone` column, and a shift is due on a
 * DATE, not an instant. Pass the group's zone through `timeZone` once real data
 * arrives (BLO-1053); until then these render in the runtime's zone, which is
 * correct for a date-only value in development.
 */
export const LOCALE = "en-GB";

/** react-day-picker / date-fns want the Locale object, not the string code. */
export const DATE_LOCALE = enGB;

const shiftDate = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const longDate = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timestamp = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "Sat 5 Jul" — the shift list, the dashboard, the member page. */
export const formatShiftDate = (date: Date) => shiftDate.format(date);

/** "Saturday 5 July 2026" — confirmation copy, where ambiguity costs. */
export const formatLongDate = (date: Date) => longDate.format(date);

/** "5 Jul, 09:00" — the SMS log, where the hour is the point. */
export const formatTimestamp = (date: Date) => timestamp.format(date);
