/**
 * Group-timezone civil-date helpers for the dashboard and shifts screens.
 *
 * A shift's `due_on` is a CIVIL date — "2026-07-13", a day on a calendar with no
 * time and no zone. The one place a real timezone matters is deciding what "today"
 * is for the group, because that is what "this week" and "upcoming" are measured
 * from, and a London house provisioned as UTC must not have its week boundary an
 * hour out. `groupToday` answers that in the group's own zone; everything after it
 * is civil-date arithmetic, which cannot drift with the host clock.
 *
 * This is deliberately NOT in `date.ts`: that module pins a single display zone
 * (`Europe/London`) shared by every screen, and threading a per-group zone through
 * it would ripple across the whole app. Rendering still goes through `date.ts` —
 * `civilDate` hands it a noon-UTC instant so no formatter can shift the day.
 */

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

// en-CA renders as YYYY-MM-DD, which is exactly a civil date string. Same trick
// date.ts uses internally to take a zone-aware date difference.
const civilFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The group's "today" as a civil date (YYYY-MM-DD) in its own timezone. */
export function groupToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A civil date string as a Date at NOON UTC. Noon (not midnight) means every real
 * zone — from UTC-11 to UTC+12 — still reads the same calendar day, so formatting
 * it through `date.ts` (which pins Europe/London) or any other zone never lands on
 * the day before or after.
 */
export function civilDate(dueOn: string): Date {
  return new Date(`${dueOn}T12:00:00Z`);
}

/** Add (or subtract) whole days to a civil date, returning a civil date string. */
export function addCivilDays(civil: string, days: number): string {
  const d = civilDate(civil);
  d.setUTCDate(d.getUTCDate() + days);
  return civilFormatter.format(d);
}

/** Chronological order of two civil dates. Lexical order of YYYY-MM-DD is chronological. */
export function compareCivil(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Within the group's current week: today through the six days after it, inclusive. */
export function isThisWeek(dueOn: string, today: string): boolean {
  return compareCivil(dueOn, today) >= 0 && compareCivil(dueOn, addCivilDays(today, 6)) <= 0;
}

/** Today or later — an upcoming shift, the only kind the admin can still override. */
export function isFutureOrToday(dueOn: string, today: string): boolean {
  return compareCivil(dueOn, today) >= 0;
}

/** True for a well-formed YYYY-MM-DD string. */
export function isCivilDate(value: string): boolean {
  return CIVIL_DATE.test(value);
}
