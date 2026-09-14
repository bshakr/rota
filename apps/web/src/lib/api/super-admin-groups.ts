import "server-only";

import { z } from "zod";

import type { SmsLogFilters } from "@/lib/hq-group-report";
import {
  DEFAULT_GROUP_SORT,
  GROUP_STATUSES,
  type GroupsQuery,
  MEMBER_STATUSES,
} from "@/lib/hq-groups";

import { superAdminRequest } from "./super-admin";
import type { IntervalUnit } from "./types";

// The operator's house endpoints — GET /api/super_admin/groups, the one group
// behind it, and the three writes that act on it — with the shape of every
// payload checked at the boundary.
//
// PARSED rather than cast, for the same reason `./super-admin-overview.ts` is and
// unlike every house-facing client in this folder. A row on this list is almost
// entirely DERIVED: five counts, three text figures, a last-activity instant and
// a status that the list also FILTERS on. A key Rails renames does not render as
// an obvious blank — it renders as a zero that looks exactly like a real fact,
// and the operator reading "0 failures" acts on it. So a drift is a named failure
// the page can put on screen, never a plausible dashboard.
//
// Unknown keys are stripped, not rejected (zod's default). Rails ADDING a key is
// not a reason to blank this screen. `recent_sms_messages` arrives on the group
// payload today and is deliberately NOT modelled: it is the newest twenty rows
// with no filters on them, and the group page draws its log from
// GET /api/super_admin/groups/:id/sms_messages instead, so that the filter bar,
// the "load older" link and the rows the operator is reading are one thing rather
// than two that diverge the moment a filter is touched. It is a key that goes
// MISSING, or changes type, that this catches.
//
// The WORDS that go with these shapes — the pills, the schedule in words, the
// notes counter, the filter query string — live in `src/lib/hq-groups.ts`. Shape
// here, meaning there.
//
// `server-only` because every function below resolves the operator's access token
// through `requireSuperAdmin()`. The types are erased at compile time, so a Client
// Component that needs a figure is handed the figure, never the payload; see
// bundle-safety.test.ts, which matches `lib/api/super-admin` as a prefix.

// --- Primitives -------------------------------------------------------------

/**
 * A rota's recurrence unit, as a runtime list zod can use.
 *
 * MUST stay in step with `Rota::INTERVAL_UNITS`. `satisfies` ties it to the
 * `IntervalUnit` union the rest of the app already types off, so the two cannot
 * drift apart without a compile error.
 */
const INTERVAL_UNITS = ["day", "week", "month"] as const satisfies readonly IntervalUnit[];

/** A count Rails produced by counting rows: a whole number, never negative. */
const count = z.number().int().nonnegative();

/**
 * An ActiveSupport timestamp, e.g. "2026-09-13T09:12:04.000Z". Kept as the string
 * Rails sent and turned into a `Date` where it is rendered — a schema that
 * returned Dates would make the parsed payload unserialisable across an RSC
 * boundary. `offset: true` accepts "+01:00" as well as "Z".
 */
const timestamp = z.iso.datetime({ offset: true });

/** A calendar day with no time and no zone: `starts_on`, `due_on`. */
const day = z.iso.date();

// --- One house on the list --------------------------------------------------

/**
 * A row of the groups list, and the header of the group page — the same shape
 * from the same `SuperAdmin::GroupSerializer`, which is why one schema serves
 * both and why the three writes can hand their answer straight back to the page.
 */
export const groupRowSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    /**
     * False means the system guessed UTC when the house was provisioned and no
     * human has ever confirmed it — the house is being texted on a clock nobody
     * chose. It is a filter on this list for exactly that reason.
     */
    timezone_confirmed: z.boolean(),
    timezone_confirmed_at: timestamp.nullable(),
    created_at: timestamp,
    /** NULL means live. The moment, because "paused since when" is the first thing asked. */
    suspended_at: timestamp.nullable(),
    /** Operator-only free text. No house-facing serializer carries this key. */
    notes: z.string().nullable(),
    status: z.enum(GROUP_STATUSES),
    admins_count: count,
    active_members_count: count,
    running_rotas_count: count,
    /** Staffed but switched off: neither a draft nor a rota that is texting anyone. */
    paused_rotas_count: count,
    draft_rotas_count: count,
    /** Texts the house actually tried to send in the window, and the two ways that goes wrong. */
    texts_last_7_days: count,
    /** Claimed but never sent — a stuck queue, invisible inside a single total. */
    unsent_texts_last_7_days: count,
    failed_texts_last_7_days: count,
    /** The latest of the last text, the last admin seen and the last housemate seen. */
    last_activity_at: timestamp.nullable(),
  })
  // The pill and the column are TWO renderings of one fact, and the list FILTERS
  // on the pill. `SuperAdmin::GroupStatus` answers "suspended" if and only if
  // `suspended_at` is set, so a payload where they disagree would draw a Live
  // pill over a paused house — entirely plausible, and the operator would go on
  // to wonder why its reminders stopped. This is the assertion that it still does.
  .superRefine((group, ctx) => {
    const paused = group.suspended_at !== null;
    if (paused === (group.status === "suspended")) return;

    ctx.addIssue({
      code: "custom",
      path: ["status"],
      message: paused
        ? `is "${group.status}" for a house paused at ${group.suspended_at}`
        : 'is "suspended" for a house with no suspended_at',
    });
  });

export type GroupRow = z.infer<typeof groupRowSchema>;

// --- The people and the rotas behind one house ------------------------------

const adminSchema = z.object({
  /** The GroupAdmin membership's id — the same person appears again under another house. */
  id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  /**
   * NULLABLE, for the same reason `email` below is: an AuthKit access token
   * carries no `name` claim unless the WorkOS JWT template was configured to add
   * one, `users.name` has no NOT NULL on it, and `User.defaults_from` writes
   * whatever the claim held — which is nothing. Rails serves that as null rather
   * than inventing a name; `adminLabel` in src/lib/hq-groups.ts decides what the
   * page says instead. Typed non-null, this blanked the whole house page with a
   * shape error for every house whose first admin signed in before the template
   * carried a name (https://linear.app/bloombase/issue/BLO-1694).
   */
  name: z.string().nullable(),
  /**
   * Null when the only address we hold is the `.invalid` placeholder a JIT
   * provision writes (an AuthKit token carries no email unless the WorkOS JWT
   * template adds one). The page renders null as "not provided" rather than an
   * address that looks deliverable and is not.
   */
  email: z.string().nullable(),
  /** The id to paste into the WorkOS dashboard, where impersonation and resets live. */
  workos_user_id: z.string(),
  role: z.string(),
});

const memberSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  /** In full, on purpose: a wrong country code is what "why didn't Alice get her text" usually is. */
  phone_e164: z.string(),
  status: z.enum(MEMBER_STATUSES),
  sms_opted_out_at: timestamp.nullable(),
  /** Which rotas this person actually sits on — the answer to "why is this house sending nothing". */
  rotas: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
});

const rotaSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  active: z.boolean(),
  /** Derived from the roster, never stored: a draft rota is one with nobody on it. */
  draft: z.boolean(),
  roster_size: count,
  // The schedule as its PARTS. Rails deliberately ships no phrasing — there is no
  // "every other Tuesday" helper in the app — so `scheduleInWords` in
  // src/lib/hq-groups.ts turns these into English beside the rest of the copy.
  starts_on: day,
  interval_count: z.number().int().positive(),
  interval_unit: z.enum(INTERVAL_UNITS),
  send_hour: z.number().int().min(0).max(23),
  reminder_offsets: z.array(z.number().int().nonnegative()),
});

export type GroupRota = z.infer<typeof rotaSchema>;

// --- The delivery log, redacted ---------------------------------------------

/** Just enough of a person to name them on a log row. */
const memberRef = z.object({ id: z.number().int().positive(), name: z.string() });

/**
 * One line of a house's delivery log as `SuperAdmin::SmsMessageSerializer` renders
 * it — the house's own row with the magic link struck out of the body.
 *
 * `body` IS NULLABLE, and that is the one field where this shape differs from the
 * house's own `SmsMessage`. A row that has not been sent yet has no body at all,
 * and Rails answers null rather than "" on purpose: an empty string would read as
 * "we sent a blank text". The renderer says "Not written yet" for it.
 *
 * Used twice: for `report.warnings_input.failed_sms` (the failures the house's own
 * dashboard counts) and for the paginated log at
 * GET /api/super_admin/groups/:id/sms_messages. One schema, because it is one
 * serializer — if it were two, the warning count and the log could disagree about
 * a row while both parsed cleanly.
 */
const redactedSmsSchema = z.object({
  id: z.number().int().positive(),
  kind: z.string(),
  /**
   * Left as a bare string, exactly as `SmsStatus` is: a new carrier state must
   * never make a valid log row fail to parse and blank the whole screen.
   */
  status: z.string(),
  error_code: z.string().nullable(),
  days_before: z.number().int().nonnegative().nullable(),
  body: z.string().nullable(),
  twilio_sid: z.string().nullable(),
  sent_at: timestamp.nullable(),
  created_at: timestamp,
  /** The number in full, for the same reason the housemates card carries it. */
  member: memberRef.extend({ phone_e164: z.string() }),
  shift: z
    .object({
      id: z.number().int().positive(),
      rota_id: z.number().int().positive(),
      rota_name: z.string(),
      due_on: day,
    })
    .nullable(),
});

export type RedactedSms = z.infer<typeof redactedSmsSchema>;

export const groupSmsMessagesSchema = z.object({ sms_messages: z.array(redactedSmsSchema) });

// --- The report (BLO-1679) --------------------------------------------------

/**
 * `report.warnings_input` — the four payloads the house's own dashboard fetches,
 * composed by `SuperAdmin::WarningsInput` through the HOUSE's own serializers.
 *
 * This is the one part of the operator payload that is deliberately NOT shaped
 * like the rest of this file: `group`, `rotas` and `members` here are
 * `::GroupSerializer`, `::RotaSerializer` and `::MemberSerializer` (minus the
 * magic-link token), not their `SuperAdmin::` cousins. That is the whole point.
 * `collectDashboardWarnings` in src/lib/dashboard.ts is the code the house admin's
 * dashboard runs, and the operator must see exactly the alerts they see — which is
 * only true if it is handed the same facts in the same shape. A second, tidier
 * shape here would be how the operator ends up missing a warning the admin has
 * been staring at for a week.
 *
 * So these fields are pinned to `src/lib/api/types.ts` rather than invented, and
 * `group-warnings.tsx` hands the parsed object straight to the collector.
 */
const warningsInputSchema = z.object({
  // ::GroupSerializer. The calendar summary is here and nowhere else on this
  // payload — `SuperAdmin::GroupSerializer` has no column for it — because "House
  // calendar isn't syncing" is one of the five warnings.
  group: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    timezone_confirmed: z.boolean(),
    timezone_confirmed_at: timestamp.nullable(),
    calendar: z
      .object({
        calendar_name: z.string().nullable(),
        /** Masked, always. The raw iCal URL is a credential and never leaves Rails. */
        masked_url: z.string(),
        events_count: count,
        unclassified_count: count,
        last_synced_at: timestamp.nullable(),
        last_error: z.string().nullable(),
        failing: z.boolean(),
      })
      .nullable(),
  }),
  // ::RotaSerializer, roster inline. `draft` is what the draft-rotas warning reads.
  rotas: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      message_template: z.string(),
      starts_on: day,
      interval_count: z.number().int().positive(),
      interval_unit: z.enum(INTERVAL_UNITS),
      send_hour: z.number().int().min(0).max(23),
      reminder_offsets: z.array(z.number().int().nonnegative()),
      active: z.boolean(),
      draft: z.boolean(),
      positions: z.array(
        z.object({
          member_id: z.number().int().positive(),
          name: z.string(),
          position: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
  // ::MemberSerializer WITHOUT `access_token`. `SuperAdmin::WarningsInput` fetches
  // that key before dropping it, so a rename on the house side is a KeyError on the
  // first request rather than a magic link quietly served on an operator path.
  members: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      phone_e164: z.string(),
      active: z.boolean(),
      /** "Active and not opted out", folded by Rails — the "won't get texts" warning reads it. */
      contactable: z.boolean(),
      sms_opted_out_at: timestamp.nullable(),
    }),
  ),
  failed_sms: z.array(redactedSmsSchema),
});

export type WarningsInput = z.infer<typeof warningsInputSchema>;

/**
 * One turn in the next fortnight, shaped like the house's own `ShiftSerializer`:
 * who is on the hook by the rota, who actually took it, and the resolved answer.
 *
 * `rota_active` and `rota_draft` ride on the SHIFT rather than being looked up in
 * the rotas table further down the page. A turn on a paused rota is a real row
 * with a real person's name on it that nobody will be told about, and an operator
 * answering "why did nobody hear about Thursday" has to see that on the row.
 */
const upcomingShiftSchema = z.object({
  id: z.number().int().positive(),
  rota_id: z.number().int().positive(),
  rota_name: z.string(),
  rota_active: z.boolean(),
  rota_draft: z.boolean(),
  /** A civil date in the HOUSE's calendar. No time, no zone — see lib/group-dates.ts. */
  due_on: day,
  covered: z.boolean(),
  assigned_member: memberRef.nullable(),
  covering_member: memberRef.nullable(),
  /** Covering if there is one, else assigned. Rails resolves it; the page never re-derives it. */
  responsible_member: memberRef.nullable(),
});

export type UpcomingShift = z.infer<typeof upcomingShiftSchema>;

/**
 * One week of the twelve-week series. `week_start` is a MONDAY in UTC — the
 * operator's week, shared with the overview and the traffic page, never this
 * house's own — so the same text lands in the same column on all three screens.
 */
const weeklyWeekSchema = z.object({
  week_start: day,
  texts: count,
  covers: count,
});

export type WeeklyWeek = z.infer<typeof weeklyWeekSchema>;

/**
 * `SuperAdmin::GroupReport`: what this house is DOING, beside who is in it.
 *
 * REQUIRED, where it used to be optional. It was tolerated as missing while the
 * page rendered only the two decorative columns it carried; now it IS the page —
 * the warnings, the fortnight, the series and both people tables all come out of
 * it — and a payload without it is a screen with nothing on it. Loud is right.
 */
const reportSchema = z.object({
  warnings_input: warningsInputSchema,
  upcoming_shifts: z.array(upcomingShiftSchema),
  /** Twelve of them, oldest first, zero-filled by Rails so a quiet month is a flat line. */
  weekly: z.array(weeklyWeekSchema),
  admins: z.array(
    adminSchema.extend({
      last_seen_at: timestamp.nullable(),
      /**
       * `user_` and not `admin_`: these are facts about the PERSON, every
       * organization and none, so an admin of two houses shows the same figure on
       * both pages. The card says so out loud rather than leaving it to a comment.
       */
      user_sign_in_count: count,
      user_sign_in_count_30d: count,
    }),
  ),
  members: z.array(memberSchema.extend({ last_seen_at: timestamp.nullable() })),
  /**
   * Rails' placeholder, still null, and deliberately NOT what the page's spend
   * card reads.
   *
   * https://linear.app/bloombase/issue/BLO-1684 landed the card and fed it from
   * `getSpend(GROUP_SPEND_RANGE)` narrowed to this house, because there is no
   * per-group spend endpoint: `SuperAdmin::Spend` answers for every house at once
   * and one house's figures are read out of the same payload the spend page
   * draws, which is what stops the two ever disagreeing about what a house cost.
   *
   * Present-and-null is REQUIRED (the key going missing is drift worth catching),
   * but a non-null value is accepted UNREAD rather than rejected: if Rails ever
   * starts filling this in, that is a reason to swap the card's source over in one
   * line, not to blank a console that is not looking at it yet.
   */
  spend: z.looseObject({}).nullable(),
});

export type GroupReport = z.infer<typeof reportSchema>;
export type ReportAdmin = GroupReport["admins"][number];
export type ReportMember = GroupReport["members"][number];

export const groupsListSchema = z.object({ groups: z.array(groupRowSchema) });

export const groupDetailSchema = z.object({
  group: groupRowSchema,
  rotas: z.array(rotaSchema),
  report: reportSchema,
});

export const groupWriteSchema = z.object({ group: groupRowSchema });

export type GroupDetail = z.infer<typeof groupDetailSchema>;

// --- Failure ----------------------------------------------------------------

/**
 * The API answered, but not with a payload these pages know how to read.
 *
 * Its own class so a page can tell it apart from an `ApiError`: one means Rails
 * refused or fell over, the other means Rails and the web app disagree about the
 * shape — a deploy skew, or a rename that only landed on one side. Different
 * words on screen, different follow-up. The exact twin of `OverviewShapeError`,
 * kept separate rather than shared so each surface names itself in its own
 * message.
 */
export class GroupsShapeError extends Error {
  readonly issues: string[];

  constructor(what: string, issues: string[]) {
    super(`The ${what} payload did not match the expected shape: ${issues.join("; ")}`);
    this.name = "GroupsShapeError";
    this.issues = issues;
  }
}

export function isGroupsShapeError(value: unknown): value is GroupsShapeError {
  return value instanceof GroupsShapeError;
}

/** Parse or throw `GroupsShapeError` naming every field that disagreed. Pure. */
function parse<T extends z.ZodType>(schema: T, what: string, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  throw new GroupsShapeError(
    what,
    result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  );
}

// --- The calls --------------------------------------------------------------

function withQuery(path: string, query: GroupsQuery): string {
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.status) search.set("status", query.status);
  // Rails casts with ActiveModel::Type::Boolean, so the flag is sent only when it
  // is on. Sending `false` would be a no-op there and a lie in the address bar.
  if (query.unconfirmed_timezone) search.set("unconfirmed_timezone", "1");
  if (query.has_failures) search.set("has_failures", "1");
  if (query.sort && query.sort !== DEFAULT_GROUP_SORT) search.set("sort", query.sort);

  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * GET /api/super_admin/groups — every house, narrowed and ordered by the operator.
 *
 * The filtering and the ordering are Rails' (the status filter has to be the same
 * code as the status pill, or the list disagrees with itself), so this sends the
 * query string and renders what comes back in the order it comes back in.
 */
export async function getGroups(query: GroupsQuery = {}): Promise<GroupRow[]> {
  const raw = await superAdminRequest<unknown>(withQuery("/api/super_admin/groups", query));
  return parse(groupsListSchema, "groups list", raw).groups;
}

/**
 * GET /api/super_admin/groups/:id — one house in full.
 *
 * A 404 from Rails means either "no such house" or "you are not an operator", and
 * this does not try to tell them apart; the page turns it into `notFound()`,
 * which is the right answer to both.
 */
export async function getGroup(id: number): Promise<GroupDetail> {
  const raw = await superAdminRequest<unknown>(`/api/super_admin/groups/${id}`);
  return parse(groupDetailSchema, "group", raw);
}

/**
 * GET /api/super_admin/groups/:id/sms_messages — one house's delivery log, with
 * the magic link struck out of every body.
 *
 * The FILTERS ARE THE HOUSE'S OWN. Rails shares them between this controller and
 * the house's (`SmsMessageFiltering`), and this sends the same five parameters the
 * house's own /sms page sends, so an operator chasing "Alice didn't get her text"
 * is looking at exactly the rows the admin who reported it can see.
 *
 * Its own request rather than the `recent_sms_messages` key that already rides on
 * the group payload: that one is the newest twenty with no filters on it, and a
 * log whose first page came from somewhere else than its second is a log that
 * changes shape the moment anything is narrowed.
 */
export async function getGroupSmsMessages(
  groupId: number,
  query: SmsLogFilters,
): Promise<RedactedSms[]> {
  const search = new URLSearchParams();
  if (query.status) search.set("status", query.status);
  if (query.kind) search.set("kind", query.kind);
  if (query.memberId) search.set("member_id", String(query.memberId));
  if (query.rotaId) search.set("rota_id", String(query.rotaId));
  // Always sent, unlike the address bar's copy: Rails defaults to 100 and this
  // page's own default happens to be the same number today, which is exactly the
  // coincidence that would go unnoticed if either moved.
  search.set("limit", String(query.limit));

  const raw = await superAdminRequest<unknown>(
    `/api/super_admin/groups/${groupId}/sms_messages?${search.toString()}`,
  );
  return parse(groupSmsMessagesSchema, "delivery log", raw).sms_messages;
}

/** What PATCH accepts. Sending `timezone` at all confirms it (Rails stamps `timezone_confirmed_at`). */
export interface GroupUpdate {
  name?: string;
  timezone?: string;
  /** Empty string clears the note: Rails stores NULL for a blank box. */
  notes?: string;
}

/**
 * PATCH /api/super_admin/groups/:id — rename, set the timezone, write the note.
 *
 * The timezone carries exactly the house's own PATCH semantics: the presence of
 * the param is a human saying "I checked", and a super admin setting it counts as
 * a human confirming it. That is most of the point of the action — the commonest
 * reason to reach for it is a house being texted on a UTC guess nobody corrected.
 */
export async function updateGroup(id: number, params: GroupUpdate): Promise<GroupRow> {
  const raw = await superAdminRequest<unknown>(`/api/super_admin/groups/${id}`, {
    method: "PATCH",
    body: params,
  });
  return parse(groupWriteSchema, "group", raw).group;
}

/**
 * POST /api/super_admin/groups/:id/suspend — pause the house.
 *
 * Idempotent, and a re-suspend never moves "paused since". Nothing is deleted;
 * see `SUSPENSION_CONSEQUENCES` in src/lib/hq-groups.ts for the list the dialog
 * puts in front of the operator before they press it.
 */
export async function suspendGroup(id: number): Promise<GroupRow> {
  const raw = await superAdminRequest<unknown>(`/api/super_admin/groups/${id}/suspend`, {
    method: "POST",
  });
  return parse(groupWriteSchema, "group", raw).group;
}

/** DELETE /api/super_admin/groups/:id/suspend — let it go again. Idempotent. */
export async function resumeGroup(id: number): Promise<GroupRow> {
  const raw = await superAdminRequest<unknown>(`/api/super_admin/groups/${id}/suspend`, {
    method: "DELETE",
  });
  return parse(groupWriteSchema, "group", raw).group;
}
