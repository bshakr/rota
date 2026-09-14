import {
  dayStringToDisplayDate,
  reminderOffsetLabel,
  scheduleLabel,
  sendHourLabel,
  sortOffsetsDesc,
} from "@/app/(admin)/rotas/rota-logic";

import type { IntervalUnit } from "./api/types";
import { formatShiftDate } from "./date";
import { plural } from "./hq-overview";

/**
 * The vocabulary of the operator's house screens — the groups list and one
 * group's page. The values Rails uses, and the words that go with them.
 *
 * `src/lib/hq-overview.ts` is the same module for the overview, and the split is
 * the same one: SHAPE lives in `./api/super-admin-groups.ts`, MEANING lives here.
 * If you arrived at the schema looking for the copy, this is where it went.
 *
 * **The unions live HERE and not beside the schema**, which is the one place this
 * differs from the overview pair, and it is deliberate. `./api/super-admin-groups`
 * is `server-only` because every call in it resolves the operator's access token,
 * and the filter bar that switches on these statuses is a Client Component. A
 * union in a server-only module is a union a client control cannot read, and the
 * alternative — a second copy of the list beside the filter bar — is exactly how
 * a filter ends up offering a status the API has never heard of. The schema
 * imports them from here; nothing flows the other way.
 *
 * Everything here is pure and takes its clock as an argument, for the reason
 * `lib/date.ts` gives: a `Date.now()` inside a component renders one string on the
 * server and another in the browser a moment later, which is a hydration mismatch
 * on pages made largely of elapsed times.
 *
 * The schedule phrasing deliberately REUSES the house's own
 * `app/(admin)/rotas/rota-logic.ts` rather than restating it. "Every 2 weeks" and
 * "on the day" are already decided there, and an operator console that spelled a
 * rota differently from the screen its admin is looking at would be describing a
 * different house.
 */

// --- The unions Rails owns --------------------------------------------------

/**
 * The status pill, and the values the list's status filter accepts.
 *
 * MUST stay in step with `SuperAdmin::GroupStatus`, whose constants these are and
 * whose precedence order this is: suspended first because it is a thing somebody
 * DID, then never-started, then quiet, then live.
 */
export const GROUP_STATUSES = ["suspended", "never_started", "quiet", "live"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/**
 * A housemate's three states, in the order they override each other.
 *
 * MUST stay in step with `SuperAdmin::MemberSerializer`. "Removed" is
 * deactivation and never a destroy — the person still appears in shift history.
 */
export const MEMBER_STATUSES = ["removed", "opted_out", "active"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * The orders the API will accept, and the one it falls back to.
 *
 * MUST stay in step with `SuperAdmin::GroupsController::SORTS`. Two of the four
 * sort on counts rather than columns, which is why the list is short and why a
 * value that is not on it must never reach Rails: it would sort by name while the
 * header claimed otherwise.
 */
export const GROUP_SORTS = ["name", "created", "last_activity", "texts"] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];
export const DEFAULT_GROUP_SORT: GroupSort = "name";

/**
 * What the list may be narrowed and ordered by, spelled exactly as
 * `SuperAdmin::GroupsController` reads it. The page forwards this object, so the
 * address bar and the request are two renderings of one state.
 */
export interface GroupsQuery {
  q?: string;
  status?: GroupStatus;
  unconfirmed_timezone?: boolean;
  has_failures?: boolean;
  sort?: GroupSort;
}

// --- The status pill --------------------------------------------------------

/** Badge variants, so a caller cannot invent a tone the design system has not got. */
export type GroupTone = "default" | "success" | "warning" | "info" | "secondary";

/**
 * The pill on every row and on the group page's header.
 *
 * **Suspended is the loud sticker** — the grape fill that wins a row — because it
 * is the one status that is a DECISION somebody made rather than a condition the
 * house drifted into, and the operator scanning for "which house did we pause"
 * must find it without reading. Never `destructive`: that variant is the blush
 * "went wrong" sticker, and nothing went wrong here.
 *
 * The operator's word is "Suspended" and the house's word is "paused" — see
 * `HOUSE_PAUSED_*` below. Two vocabularies on purpose: an operator is doing
 * something administrative, and a housemate is being told their rota is resting.
 */
export const GROUP_STATUS_PILL: Record<GroupStatus, { label: string; tone: GroupTone }> = {
  suspended: { label: "Suspended", tone: "default" },
  never_started: { label: "Never started", tone: "info" },
  quiet: { label: "Quiet", tone: "warning" },
  live: { label: "Live", tone: "success" },
};

/**
 * What the pill means, in a sentence — the line under the header on a group page,
 * and the description on the list's status filter.
 *
 * "Never started" is not "quiet", and the distinction is the whole reason both
 * exist: a house that never began is a different conversation and a different fix
 * from one that ran for a year and went silent.
 */
export const GROUP_STATUS_NOTE: Record<GroupStatus, string> = {
  suspended: "Paused by an operator. Reminders are stopped and everyone sees a paused screen.",
  never_started: "Nobody is on any rota, so this house has never sent anything.",
  quiet: "Nothing has happened here for over a month.",
  live: "Running normally.",
};

/** The filter's options, in the API's own precedence order. */
export const GROUP_STATUS_OPTIONS: readonly { value: GroupStatus; label: string }[] =
  GROUP_STATUSES.map((status) => ({ value: status, label: GROUP_STATUS_PILL[status].label }));

// --- The list's columns -----------------------------------------------------

/** The orders the list offers, and the words on each header. Keys are the API's. */
export const GROUP_SORT_LABELS: Record<GroupSort, string> = {
  name: "Name",
  created: "Created",
  last_activity: "Last activity",
  texts: "Texts (7d)",
};

/**
 * The timezone marker. An unconfirmed zone is the single most consequential thing
 * on a row — every reminder in the house may be going out an hour off — so it
 * gets words rather than an asterisk.
 */
export function timezoneNote(confirmed: boolean): string | null {
  return confirmed ? null : "Never confirmed";
}

/**
 * The texts column, as a sentence: what went out, and the two ways it goes wrong.
 *
 * Failed and unsent are told apart because they need different follow-up —
 * Twilio refused it, versus the send job never finished with it — and a single
 * total hides a stuck queue, which is exactly what this list exists to surface.
 *
 * Returns null when there is nothing wrong, so the caller renders the count alone
 * rather than "0 failed", which reads as a figure worth looking at.
 */
export function textTroubleNote(failed: number, unsent: number): string | null {
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} failed`);
  if (unsent > 0) parts.push(`${unsent} never sent`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The rota counts, as a sentence: "2 running, 1 paused, 3 drafts".
 *
 * Paused is its own word rather than folded into either of the others, because a
 * staffed rota that is switched off sends nothing and a draft sends nothing for a
 * completely different reason. "None yet" when there is no rota at all, which is
 * what a house on its first day looks like.
 */
export function rotaCountsNote(running: number, paused: number, draft: number): string {
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  if (paused > 0) parts.push(`${paused} paused`);
  if (draft > 0) parts.push(`${draft} ${plural(draft, "draft", "drafts")}`);
  return parts.length > 0 ? parts.join(", ") : "None yet";
}

/**
 * "Nothing yet" rather than a blank or an epoch. A house with no activity at all
 * is a real and common state (it was created this morning), and an empty cell
 * reads as a rendering bug.
 */
export const NO_ACTIVITY = "Nothing yet";

// --- Filters as a URL -------------------------------------------------------

/** Where the list lives. One constant, because the nav, the rows and the filters all name it. */
export const GROUPS_HREF = "/super-admin/groups";

/**
 * The list's whole state, as the page reads it and as the filter bar writes it.
 * Distinct from `GroupsQuery` (the API's parameters) only in that it always
 * carries a resolved `sort`.
 */
export interface GroupsFilters {
  q: string;
  status: GroupStatus | null;
  unconfirmedTimezone: boolean;
  hasFailures: boolean;
  sort: GroupSort;
}

export const NO_FILTERS: GroupsFilters = {
  q: "",
  status: null,
  unconfirmedTimezone: false,
  hasFailures: false,
  sort: DEFAULT_GROUP_SORT,
};

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Read the list's state off the URL, rejecting anything the API would not accept.
 *
 * A hand-edited or stale query string is ordinary — a bookmarked filter for a
 * status that was renamed, a `sort` somebody typed. Validating HERE rather than
 * forwarding it means Rails is never asked for an order it does not have (it
 * would silently fall back to name while the header claimed otherwise), and the
 * filter bar can show "All statuses" for a value it does not recognise.
 *
 * The search term is trimmed, because Rails trims it too and a URL that carries a
 * trailing space would round-trip to a different address than the one the box
 * produced.
 */
export function parseGroupsFilters(
  params: Record<string, string | string[] | undefined>,
): GroupsFilters {
  const status = one(params.status);
  const sort = one(params.sort);

  return {
    q: (one(params.q) ?? "").trim(),
    status: GROUP_STATUSES.includes(status as GroupStatus) ? (status as GroupStatus) : null,
    unconfirmedTimezone: TRUE_VALUES.has(one(params.unconfirmed_timezone) ?? ""),
    hasFailures: TRUE_VALUES.has(one(params.has_failures) ?? ""),
    sort: GROUP_SORTS.includes(sort as GroupSort) ? (sort as GroupSort) : DEFAULT_GROUP_SORT,
  };
}

/**
 * The filters as the API's query parameters. The page forwards exactly this, so
 * the address bar and the request are two renderings of one object rather than
 * two hand-built strings that can drift.
 */
export function groupsQuery(filters: GroupsFilters): GroupsQuery {
  return {
    q: filters.q || undefined,
    status: filters.status ?? undefined,
    unconfirmed_timezone: filters.unconfirmedTimezone || undefined,
    has_failures: filters.hasFailures || undefined,
    sort: filters.sort,
  };
}

/**
 * The filters as a query STRING — "?q=alma&status=live", or "" for the unfiltered
 * list.
 *
 * Defaults are omitted, every time. A URL that spells out `sort=name&q=` for the
 * plain list is one an operator cannot tell apart from a filtered one at a
 * glance, cannot share as "the list", and that makes "are any filters on?" a
 * question about string length. Order is fixed so the same state always produces
 * the same address.
 */
export function groupsSearchParams(filters: GroupsFilters): string {
  const search = new URLSearchParams();
  if (filters.q) search.set("q", filters.q);
  if (filters.status) search.set("status", filters.status);
  if (filters.unconfirmedTimezone) search.set("unconfirmed_timezone", "1");
  if (filters.hasFailures) search.set("has_failures", "1");
  if (filters.sort !== DEFAULT_GROUP_SORT) search.set("sort", filters.sort);

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** The list's own address for a given state — what a sort header and "clear" link to. */
export function groupsHref(filters: GroupsFilters): string {
  return `${GROUPS_HREF}${groupsSearchParams(filters)}`;
}

/** Is anything narrowing this list? Decides which empty state the page shows. */
export function hasNarrowingFilters(filters: GroupsFilters): boolean {
  return Boolean(filters.q || filters.status || filters.unconfirmedTimezone || filters.hasFailures);
}

// --- A rota, in words -------------------------------------------------------

/** The parts Rails ships. There is no phrasing in the API, on purpose. */
export interface RotaSchedule {
  starts_on: string;
  interval_count: number;
  interval_unit: IntervalUnit;
}

/**
 * "Every 2 weeks, from Sat 5 Jul" — the recurrence and where the rotation is
 * counted from.
 *
 * The start date is not decoration: with an interval longer than a week it is the
 * only thing that says WHICH week, and it is what an operator checks when a house
 * says its turns land on the wrong day.
 */
export function scheduleInWords(rota: RotaSchedule): string {
  const recurrence = scheduleLabel(rota.interval_count, rota.interval_unit);
  return `${recurrence}, from ${formatShiftDate(dayStringToDisplayDate(rota.starts_on))}`;
}

/**
 * "2 days before, on the day" — longest lead first, which is the order the
 * reminders actually go out in.
 *
 * Offset 0 is "on the day" and never "0 days before"; that spelling belongs to
 * `reminderOffsetLabel`, which the house's own rota screens use, and is reused
 * rather than repeated. No offsets at all is a real state and says so.
 */
export function reminderOffsetsInWords(offsets: number[]): string {
  if (offsets.length === 0) return "No reminders";
  return sortOffsetsDesc(offsets).map(reminderOffsetLabel).join(", ");
}

/** "texts at 09:00" — the hour in the HOUSE's timezone, which is why the row says so. */
export function sendHourInWords(hour: number): string {
  return `texts at ${sendHourLabel(hour)}`;
}

/** Running, paused or draft — the same three states the counts on the list are split by. */
export function rotaStateLabel(rota: { active: boolean; draft: boolean }): {
  label: string;
  tone: GroupTone;
} {
  if (rota.draft) return { label: "Draft", tone: "secondary" };
  if (!rota.active) return { label: "Paused", tone: "warning" };
  return { label: "Running", tone: "success" };
}

/** The roster, as a count. A draft rota has nobody on it, which is why it sends nothing. */
export function rosterNote(size: number): string {
  if (size === 0) return "Nobody on it";
  return `${size} ${plural(size, "person", "people")} on it`;
}

// --- People -----------------------------------------------------------------

/**
 * What we hold for an admin's email.
 *
 * An AuthKit access token carries no email unless the WorkOS JWT template was
 * configured to add one, so a first sighting is provisioned with a placeholder at
 * an `.invalid` domain and Rails serves that as null. "Not provided" is the
 * honest rendering; printing the placeholder would put an address on screen that
 * looks deliverable and is not.
 */
export const NO_EMAIL = "Not provided";

/** Where an operator goes to impersonate or reset — deliberately not built here. */
export function workosUserUrl(workosUserId: string): string {
  return `https://dashboard.workos.com/users/${encodeURIComponent(workosUserId)}`;
}

/** A housemate's state, as a pill. Opted out is a warning; removed is simply past. */
export const MEMBER_STATUS_PILL: Record<MemberStatus, { label: string; tone: GroupTone }> = {
  removed: { label: "Removed", tone: "secondary" },
  opted_out: { label: "Opted out", tone: "warning" },
  active: { label: "Active", tone: "success" },
};

/** "on 2 rotas" / "on no rota" — the answer to "why is this house sending nothing". */
export function memberRotasNote(rotas: { name: string }[]): string {
  if (rotas.length === 0) return "On no rota";
  return rotas.map((rota) => rota.name).join(", ");
}

// --- Notes ------------------------------------------------------------------

/**
 * The ceiling Rails enforces (`Group::NOTES_MAX`). Stated here so the counter can
 * be honest BEFORE the request, rather than turning a paste into a validation
 * error the operator has to read to understand.
 */
export const NOTES_MAX = 2000;

/**
 * The counter under the notes box: how much room is left, and whether the box is
 * over.
 *
 * Counts what is LEFT rather than what has been typed. "1,847 of 2,000" makes the
 * reader do the subtraction at the only moment they care about the number, which
 * is when they are close to the edge. Over the limit it says by how much, because
 * "0 left" and "47 too many" ask for different amounts of editing.
 *
 * The limit is a character count on both sides — Rails validates `length`, which
 * for a Ruby string is characters, and JavaScript's `String#length` is UTF-16
 * code units. They differ only above the basic plane (an emoji counts as two
 * here, one there), which errs toward the operator being warned slightly early
 * rather than being refused by the server without warning.
 */
export function notesCounter(value: string): { text: string; over: boolean } {
  const remaining = NOTES_MAX - value.length;
  if (remaining < 0) {
    return { text: `${-remaining} over the ${NOTES_MAX.toLocaleString("en-GB")} limit`, over: true };
  }
  return { text: `${remaining.toLocaleString("en-GB")} left`, over: false };
}

// --- Suspension, in the operator's words ------------------------------------

/**
 * What pressing Suspend actually does, listed before it happens.
 *
 * The plan asks for this by name ("the dialog names what suspension does"), and
 * the last line is the one that matters: suspension is NOT a delete, and an
 * operator who believes it might be will never reach for it on the day they
 * should. Every item is a real enforcement point in the API
 * (https://linear.app/bloombase/issue/BLO-1675), not a description of intent.
 */
export const SUSPENSION_CONSEQUENCES: readonly string[] = [
  "Reminders and cover notices stop going out.",
  "Admins signing in see a paused screen instead of the house.",
  "Housemates opening their link see a paused page, and cannot hand over a turn.",
  "The household entry page stops handing out personal links.",
  "Nothing is deleted. Resuming puts every one of these back.",
];

/** What resuming does. Short on purpose: it is the undo, and it undoes everything. */
export const RESUME_CONSEQUENCES: readonly string[] = [
  "Reminders start going out again from the next sweep.",
  "Admins and housemates get their screens back.",
  "Nothing from the paused period is re-sent. There is no backlog of old reminders.",
];

// --- Suspension, in the house's words ---------------------------------------

/**
 * The paused screen's copy, in the HOUSE voice — warm, blameless, and with a way
 * out. The plan's sentence is "This house is paused. Nothing is lost. Email us to
 * pick it back up."; "us" is now the address itself, because a screen that says
 * "email us" and then names nobody is asking the reader to go and find out who.
 *
 * One set of words for all three surfaces (the admin layout, the member page and
 * the household entry page) so a housemate and their admin are told the same
 * thing. Each surface decides its own surrounding tone; the promise does not
 * change.
 *
 * The body is SPLIT because the address inside it has to be a real `mailto:`
 * link, and a link cannot live inside a string. The component assembles the two
 * halves around it; `housePausedBody` reassembles the same sentence as plain text
 * so the words can be asserted without a DOM. The address itself is NOT here —
 * it is `CONTACT_EMAIL` in src/lib/site.ts, which the footer, the privacy page
 * and the terms page already name, and which is the only place it is spelled.
 */
export const HOUSE_PAUSED_TITLE = "This house is paused";
export const HOUSE_PAUSED_BODY_LEAD = "Nothing is lost. Email ";
export const HOUSE_PAUSED_BODY_TAIL = " to pick it back up.";

/** The title with the house's name in it, when the surface knows it. */
export function housePausedTitle(name: string | null): string {
  return name ? `${name} is paused` : HOUSE_PAUSED_TITLE;
}

/** The body as one plain sentence, for assertions and for anything that cannot render a link. */
export function housePausedBody(address: string): string {
  return `${HOUSE_PAUSED_BODY_LEAD}${address}${HOUSE_PAUSED_BODY_TAIL}`;
}
