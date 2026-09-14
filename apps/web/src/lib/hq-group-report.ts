import type { UpcomingShift, WeeklyWeek } from "./api/super-admin-groups";
import type { SmsKind, SmsStatus } from "./api/types";
import type { ChartPoint } from "./charts";
import type { DashboardWarning } from "./dashboard";
import { formatShiftDate } from "./date";
import { addCivilDays, civilDate, compareCivil } from "./group-dates";
import { GROUPS_HREF, type GroupTone, rotaStateLabel } from "./hq-groups";
import { plural } from "./hq-overview";
import { weekOfLabel } from "./hq-traffic";
import { isKnownSmsKind, isKnownSmsStatus } from "./sms-display";

/**
 * The words and the judgement behind the REPORT half of a group page — what a
 * house is doing, as opposed to who is in it.
 *
 * ./hq-groups.ts is the other half and the pair matches the API exactly: Rails
 * serves one house's identity through `SuperAdmin::GroupSerializer` and the rest
 * through `SuperAdmin::GroupReport`, a query object of its own. Shape for both
 * lives in ./api/super-admin-groups.ts; MEANING is split the same way the data is.
 *
 * Everything here is pure and takes its clock as an argument, for the reason
 * lib/date.ts gives: a `Date.now()` inside a component renders one string on the
 * server and another in the browser a moment later, which is a hydration mismatch
 * on a page made largely of elapsed times.
 *
 * Four things in here are decisions rather than formatting, and each is tested:
 *
 *   - A WARNING'S DESTINATION. The alerts are the house's own, collected by the
 *     house's own code; where "fix it" GOES cannot be, and sending an operator to
 *     `/rotas` would open their own house's rotas.
 *   - WHO HOLDS A TURN. A cover is this product's one real engagement signal, so
 *     a covered turn names both people or it has erased the thing worth seeing.
 *   - WHETHER A TURN IS SILENT. A turn on a paused or draft rota is a real row
 *     with a real name on it that nobody will be told about.
 *   - THE LOG'S FILTERS AS A URL. The address bar and the request have to be two
 *     renderings of one object, or a shared link shows a different log.
 */

// --- The page's own sections ------------------------------------------------

/**
 * The anchors on a group page. Ids rather than prose because they are read twice:
 * once as the `id` of a card, and once as the destination of a warning that wants
 * the operator to look at it.
 */
export const GROUP_SECTION = {
  header: "house-header",
  warnings: "house-warnings",
  upcoming: "upcoming-turns",
  usage: "house-usage",
  smsLog: "sms-log",
  admins: "house-admins",
  members: "housemates",
  rotas: "house-rotas",
} as const;

/** One house's page. The list's rows and the back link already spell the prefix. */
export function groupHref(groupId: number): string {
  return `${GROUPS_HREF}/${groupId}`;
}

// --- Warnings, pointed at the operator's own screen --------------------------

/**
 * `settingsHref` for `collectDashboardWarnings` when the OPERATOR is the reader.
 *
 * The house's dashboard passes the route of its own settings screen. There is no
 * such screen here — the same three fields are behind the "Rename & timezone"
 * dialog in this page's header — so the header is where the operator is sent.
 */
export const OPERATOR_SETTINGS_HREF = `#${GROUP_SECTION.header}`;

/**
 * Where each of the house's warnings sends an OPERATOR, and what the link says.
 *
 * The alerts themselves are not touched: same collector, same titles, same
 * descriptions, same order, same severities — that is the guarantee the plan asks
 * for, and it is the whole reason this page runs the house's own code over the
 * house's own facts rather than restating the rules.
 *
 * The DESTINATIONS have to change, and this is not a cosmetic difference. Every
 * href `collectDashboardWarnings` produces is a house-admin route: `/sms`,
 * `/rotas`, `/members`. An operator clicking one would not open this house — they
 * would open THEIR OWN, scoped by their own token, and read a failure count that
 * belongs to somebody else. So each warning is re-aimed at the section of this
 * page that answers it, and the link's words change with it, because "Open the
 * SMS log" pointing at a card three inches below is a different promise from the
 * same words pointing at another screen.
 *
 * "House calendar isn't syncing" is the one with nowhere to go: the operator
 * cannot re-enter somebody's iCal URL, and this console deliberately has no
 * calendar surface. Its honest destination is the people who CAN fix it, so it
 * points at the admins card.
 *
 * Keyed by `DashboardWarning["id"]`, which is stable and is what its own doc
 * comment calls it ("stable key for React and for tests").
 * hq-group-report.test.ts pins the five ids against src/lib/dashboard.ts, so a
 * sixth warning cannot ship with a house route still on it.
 */
export const OPERATOR_WARNING_TARGETS: Readonly<
  Record<string, { href: string; action: string }>
> = {
  timezone: { href: `#${GROUP_SECTION.header}`, action: "Set it from the header" },
  "calendar-sync": { href: `#${GROUP_SECTION.admins}`, action: "Find who runs this house" },
  "failed-sms": { href: `#${GROUP_SECTION.smsLog}`, action: "Read the delivery log below" },
  "draft-rotas": { href: `#${GROUP_SECTION.rotas}`, action: "See this house's rotas" },
  uncontactable: { href: `#${GROUP_SECTION.members}`, action: "See the housemates" },
};

/**
 * One warning, re-aimed at this page.
 *
 * An id with no entry keeps its title and its words and is pointed at the top of
 * the house rather than off to the operator's own — a new warning arriving before
 * this map hears about it should be UNDERINFORMATIVE, never wrong about whose
 * house it is describing.
 */
export function operatorWarning(warning: DashboardWarning): DashboardWarning {
  const target = OPERATOR_WARNING_TARGETS[warning.id];
  if (!target) return { ...warning, href: `#${GROUP_SECTION.header}`, action: "Back to the top" };

  return { ...warning, href: target.href, action: target.action };
}

/** The line above the alerts, in the operator's voice rather than the house's. */
export const WARNINGS_NOTE =
  "Exactly what this house's own admins see on their dashboard, collected by the same code from the same facts.";

/** What it means when there are none. Not a blank: "nothing wrong" is a real answer. */
export const WARNINGS_NONE =
  "Nothing is wrong that this house's dashboard would tell them about.";

// --- The next fortnight -----------------------------------------------------

/**
 * How far ahead Rails looked. `SuperAdmin::GroupReport::UPCOMING_DAYS`, copied by
 * hand and pinned in hq-group-report.test.ts beside the Ruby, so the window can
 * only be widened by editing this line — which means opening the Ruby.
 *
 * It is said in words on the card rather than left implicit: "nothing due" over an
 * unstated window is not an answer an operator can act on.
 */
export const UPCOMING_DAYS = 14;

/** One calendar day of the house's fortnight, with the turns due on it. */
export interface UpcomingDay {
  due_on: string;
  /** "Today" / "Tomorrow", or null when the date has to speak for itself. */
  soon: string | null;
  /** "Sat 5 Jul". Always present — a relative word alone makes a screenshot undatable. */
  date: string;
  shifts: UpcomingShift[];
}

/**
 * The fortnight, grouped into the days it actually happens on.
 *
 * DAYS WITH NOTHING ON THEM ARE NOT DRAWN. Fourteen rows of which three carry a
 * turn is eleven rows of nothing, and on a phone that is most of a screen; the
 * card says how many days the window covers in words instead.
 *
 * Rails' order is kept exactly (due date, then rota name, then id), so the rota
 * that texts first is the row that reads first.
 *
 * `due_on` is a CIVIL date — "2026-07-13", a day on a calendar with no time and
 * no zone — so grouping is string equality and nothing here can drift with a host
 * clock. The one place a zone matters is what "today" IS, and that answer is the
 * caller's: pass `groupToday(now, group.timezone)` from lib/group-dates.ts, which
 * is the house's own midnight and never the server's. A house in Auckland must
 * not be told its Tuesday turn is "tomorrow" because London has not got there yet.
 */
export function upcomingDays(shifts: readonly UpcomingShift[], today: string): UpcomingDay[] {
  const days: UpcomingDay[] = [];

  for (const shift of shifts) {
    const last = days.at(-1);
    if (last && last.due_on === shift.due_on) {
      last.shifts.push(shift);
      continue;
    }

    days.push({
      due_on: shift.due_on,
      soon: soonLabel(shift.due_on, today),
      date: formatShiftDate(civilDate(shift.due_on)),
      shifts: [shift],
    });
  }

  return days;
}

/**
 * "Today" / "Tomorrow" / null.
 *
 * Only two words, and only forwards. This window starts at the house's today, so
 * "yesterday" cannot arise; and past "tomorrow" the weekday is more use than a
 * countdown — "in 9 days" tells an operator nothing they can put in an email,
 * whereas "Thu 23 Jul" does.
 */
function soonLabel(dueOn: string, today: string): string | null {
  if (compareCivil(dueOn, today) === 0) return "Today";
  return dueOn === addCivilDays(today, 1) ? "Tomorrow" : null;
}

/** Nobody is on the hook for this turn — a real state, and one worth seeing. */
export const NOBODY_ON_TURN = "Nobody assigned";

/**
 * Who actually holds a turn, and who handed it over.
 *
 * BOTH NAMES, always, when there is a cover. A cover is the one genuine
 * engagement signal this product has — somebody swapped a turn with a housemate
 * — and collapsing it to the name of whoever ends up doing the job erases it from
 * the screen that exists to see it. "Bob, covering for Alice" is two facts.
 *
 * The holder is Rails' `responsible_member` and is never re-derived here. That
 * precedence (covering, else assigned) is what the reminder job, the calendar and
 * the member's own page all use, and a console that computed it again would
 * eventually disagree with who actually gets texted.
 */
export function turnHolder(shift: UpcomingShift): { name: string; covering: string | null } {
  const name = shift.responsible_member?.name ?? NOBODY_ON_TURN;
  // `covered` is the flag, but the phrase needs the name it is covering FOR. A
  // covered turn whose assignee has since been removed keeps the marker and drops
  // the phrase, rather than printing "covering for undefined".
  const covering =
    shift.covered && shift.assigned_member ? `covering for ${shift.assigned_member.name}` : null;

  return { name, covering };
}

/**
 * Whether anybody will actually be told about this turn, as a pill — the same
 * three states, in the same words and the same tones, as the rotas card.
 *
 * `rotaStateLabel` is reused rather than restated for that reason: a turn marked
 * "Paused" on one card and a rota marked "Switched off" on the next, three inches
 * apart, is a page describing two different houses.
 */
export function turnRotaState(
  shift: UpcomingShift,
  { suspended = false }: { suspended?: boolean } = {},
): { label: string; tone: GroupTone } {
  return rotaStateLabel({ active: shift.rota_active, draft: shift.rota_draft }, { suspended });
}

/** Is this turn one nobody will hear about? */
export function turnIsSilent(
  shift: UpcomingShift,
  { suspended = false }: { suspended?: boolean } = {},
): boolean {
  return suspended || shift.rota_draft || !shift.rota_active;
}

/**
 * Why nobody will hear about this turn — the sentence beside the pill.
 *
 * Three reasons, one line each, in the order they override each other, because
 * they have three different fixes: resume the house, put someone on the roster,
 * switch the rota back on. A single "no text will go out" would be true and
 * useless.
 *
 * Null when the turn is a perfectly ordinary one, so the row says nothing rather
 * than reassuring the reader in a sentence they then have to read on every row.
 */
export function turnSilenceNote(
  shift: UpcomingShift,
  { suspended = false }: { suspended?: boolean } = {},
): string | null {
  if (suspended) return "The house is paused, so no text goes out for this turn.";
  if (shift.rota_draft) return "Draft rota: nobody is on the roster, so nothing is sent.";
  if (!shift.rota_active) return "Paused rota: the reminder sweep skips it, so nothing is sent.";
  return null;
}

/**
 * "Nothing due in the next 14 days." — said, rather than left as an empty card.
 *
 * It names the house's own calendar out loud because the window really is the
 * house's: Rails measured it from the group's midnight, so a house in Auckland's
 * fortnight is not the operator's fortnight, and "the next 14 days" alone invites
 * the reader to assume it is.
 */
export function upcomingWindowNote(days: number, turns: number): string {
  if (turns === 0) return `Nothing is due in the next ${days} days.`;
  return `${turns} ${plural(turns, "turn", "turns")} over the next ${days} days, counted on this house's own calendar.`;
}

// --- The people, as the report knows them -----------------------------------

/**
 * How the two sign-in counts are labelled, and the reason they are labelled at
 * all rather than printed as bare numbers.
 *
 * They are facts about the PERSON, not about this house: Rails counts
 * `sign_ins` for the user across every organization and none (hence its own
 * `user_` prefix on both keys), because a sign-in that names no organization is
 * the funnel step the table was added for, and because the question a group page
 * asks of an admin is "is this person still using Rota Monster". An admin of two
 * houses therefore shows the same figure on both pages, on purpose.
 *
 * A bare "12 sign-ins" on a page that is otherwise entirely about one house would
 * read as "signed in to this house", which is precisely what it is not — and an
 * operator would go on to conclude a quiet house had an active admin.
 */
export const ADMIN_SIGN_INS_LABEL = "Sign-ins, all houses";

/** The housemate column beside it, in the words the plan uses for it. */
export const MEMBER_LAST_SEEN_LABEL = "last opened their link";

// --- Twelve weeks of usage --------------------------------------------------

/**
 * The two series the group page draws, in the order it draws them.
 *
 * SMALL MULTIPLES rather than two lines on one chart, and that is the one-axis
 * rule: a busy house sends dozens of texts a week and records one cover a month,
 * so drawn together the covers line would be flat on the floor — or would need a
 * second y-scale, which is the worst thing a chart can do. Two little panels
 * compare perfectly well by shape.
 *
 * Both are genuine event counts and both therefore print a range total. Neither
 * is a distinct count, so adding twelve weeks up is a true statement.
 */
export const USAGE_SERIES: ReadonlyArray<{
  key: keyof Pick<WeeklyWeek, "texts" | "covers">;
  label: string;
  note: string;
}> = [
  {
    key: "texts",
    label: "Texts sent",
    note: "Reminders, cover notices and personal links that Twilio was actually asked to send — a row still queued is not a text that went out.",
  },
  {
    key: "covers",
    label: "Covers",
    note: "One per cover notice: somebody handed a turn to a housemate. This product's one real engagement signal.",
  },
];

/**
 * A series as points for `Sparkline`, oldest first.
 *
 * ZERO, NEVER NULL. Rails zero-fills the twelve buckets, and a week in which this
 * house sent nothing is a week in which it sent nothing — a measured zero, which
 * the line should sit on the floor for. `null` in a `ChartPoint` means "not
 * measured" and is drawn as a gap, which would say something quite different.
 */
export function usagePoints(
  weeks: readonly WeeklyWeek[],
  key: "texts" | "covers",
): ChartPoint[] {
  return weeks.map((week) => ({ label: weekOfLabel(week.week_start), value: week[key] }));
}

/** The whole window as one number. Safe to add: both series count events, not people. */
export function usageTotal(weeks: readonly WeeklyWeek[], key: "texts" | "covers"): number {
  return weeks.reduce((sum, week) => sum + week[key], 0);
}

/**
 * The newest bucket is the week we are INSIDE, so it runs from its Monday to now
 * rather than to Sunday. Saying so is the difference between a quiet Tuesday and
 * a house that has stopped.
 */
export const USAGE_LATEST_NOTE = "so far";

// --- The delivery log's filters as a URL ------------------------------------

/**
 * The page size, and the ceiling. Both are `SmsMessageFiltering`'s
 * (DEFAULT_LIMIT = 100, MAX_LIMIT = 500) and are named here so the "load older"
 * link can stop offering itself at the cap rather than asking for 600 rows and
 * getting 500 with no way to tell.
 */
export const SMS_LOG_PAGE = 100;
export const SMS_LOG_MAX_LIMIT = 500;

/**
 * The log's whole state, as the page reads it and as the filter bar writes it.
 *
 * The param NAMES are Rails' own (`status`, `kind`, `member_id`, `rota_id`,
 * `limit`) and are shared with the house's own /sms page, because
 * `SmsMessageFiltering` serves both controllers. That is what lets an operator
 * paste a filter an admin described to them and see the same rows.
 */
export interface SmsLogFilters {
  status: SmsStatus | null;
  kind: SmsKind | null;
  memberId: number | null;
  rotaId: number | null;
  limit: number;
}

export const NO_SMS_LOG_FILTERS: SmsLogFilters = {
  status: null,
  kind: null,
  memberId: null,
  rotaId: null,
  limit: SMS_LOG_PAGE,
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function id(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Read the log's state off the URL, rejecting anything Rails would not accept.
 *
 * A hand-edited or stale query string is ordinary — a bookmarked filter for a
 * housemate who has since been removed, a `status` somebody typed. Validating
 * HERE means Rails is never asked to match a status it does not write (which
 * returns nothing, and an empty log reads as "this house sent no texts", the
 * worst possible wrong answer on this page). The filter bar shows "All …" for a
 * value it does not recognise, off the same list.
 *
 * The limit is clamped to the API's own cap rather than forwarded: asking for
 * 100,000 rows gets 500 back with nothing on screen to say the number was
 * ignored.
 */
export function parseSmsLogFilters(
  params: Record<string, string | string[] | undefined>,
): SmsLogFilters {
  const status = one(params.status);
  const kind = one(params.kind);
  const requested = Number(one(params.limit));

  return {
    status: isKnownSmsStatus(status) ? status : null,
    kind: isKnownSmsKind(kind) ? kind : null,
    memberId: id(one(params.member_id)),
    rotaId: id(one(params.rota_id)),
    limit:
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, SMS_LOG_MAX_LIMIT)
        : SMS_LOG_PAGE,
  };
}

/**
 * The filters as a query STRING — "?status=failed", or "" for the plain log.
 *
 * Defaults are omitted, every time, and the order is fixed, so one state always
 * produces one address: a URL spelling out `limit=100` for an unfiltered log is
 * one an operator cannot tell from a narrowed one at a glance and cannot share as
 * "the house". It is the exact inverse of `parseSmsLogFilters` — round-tripped in
 * hq-group-report.test.ts — which is what keeps the address bar and the request
 * two renderings of one object rather than two hand-built strings.
 */
export function smsLogSearchParams(filters: SmsLogFilters): string {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.kind) search.set("kind", filters.kind);
  if (filters.memberId) search.set("member_id", String(filters.memberId));
  if (filters.rotaId) search.set("rota_id", String(filters.rotaId));
  if (filters.limit !== SMS_LOG_PAGE) search.set("limit", String(filters.limit));

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** This house's page in a given log state — what the filter bar and "load older" link to. */
export function groupLogHref(groupId: number, filters: SmsLogFilters): string {
  return `${groupHref(groupId)}${smsLogSearchParams(filters)}`;
}

/** Is anything narrowing the log? Decides which empty state the card shows. */
export function hasSmsLogFilters(filters: SmsLogFilters): boolean {
  return Boolean(filters.status || filters.kind || filters.memberId || filters.rotaId);
}

/**
 * The next page size, or null at the cap.
 *
 * The log grows by whole pages rather than paginating, exactly as the house's own
 * does: there is no cursor in this API, so "older" is a bigger `limit`. Null is
 * what makes the button disappear instead of asking for a 600 the server would
 * silently round down.
 */
export function nextSmsLogLimit(limit: number): number | null {
  if (limit >= SMS_LOG_MAX_LIMIT) return null;
  return Math.min(limit + SMS_LOG_PAGE, SMS_LOG_MAX_LIMIT);
}

/**
 * What the log's footer says: how much is on screen, and whether that is all
 * there is.
 *
 * "Showing 100 messages" under exactly 100 rows is the one case where the count
 * is not the answer — it means the page filled, and there is almost certainly
 * more. The wording says so rather than leaving the operator to infer it from a
 * button.
 */
export function smsLogCountNote(shown: number, limit: number): string {
  if (shown === 0) return "No messages.";
  if (shown >= SMS_LOG_MAX_LIMIT) return `Showing the most recent ${SMS_LOG_MAX_LIMIT} messages.`;
  if (shown >= limit) return `Showing the most recent ${shown}. There are probably older ones.`;
  return `Showing all ${shown} ${plural(shown, "message", "messages")}.`;
}

/** A body Rails has nothing to show for: the row was never sent. */
export const NO_SMS_BODY = "Not written yet — this row was never sent.";

/** Said once, above the log: the operator is reading redacted bodies, on purpose. */
export const SMS_REDACTION_NOTE =
  "Personal links are struck out of every body — they are permanent logins to this house.";

/**
 * Said only on a narrow screen, above a table that is wider than it.
 *
 * The log's own box scrolls sideways so the PAGE never does, and on a phone that
 * leaves the type and the delivery status past the right edge. Without a line
 * saying so a clipped column reads as a rendering bug rather than as something
 * to drag — and the status is the column somebody opened this log to read.
 */
export const SMS_LOG_SCROLL_NOTE =
  "The table scrolls sideways here: the message type and its delivery status are off to the right.";
