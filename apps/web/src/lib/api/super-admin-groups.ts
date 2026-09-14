import "server-only";

import { z } from "zod";

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
// not a reason to blank this screen — `recent_sms_messages` and most of `report`
// arrive today and are deliberately not modelled here, because the screens that
// render them are https://linear.app/bloombase/issue/BLO-1680. It is a key that
// goes MISSING, or changes type, that this catches.
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
  name: z.string(),
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

export type GroupAdmin = z.infer<typeof adminSchema>;
export type GroupMember = z.infer<typeof memberSchema>;
export type GroupRota = z.infer<typeof rotaSchema>;

// --- The report (BLO-1679) --------------------------------------------------

/**
 * `report` is `SuperAdmin::GroupReport`, and most of it belongs to
 * https://linear.app/bloombase/issue/BLO-1680: the warnings, the fortnight of
 * upcoming turns, the twelve-week series and the spend tile are all in that
 * ticket and are deliberately not modelled here.
 *
 * What this page takes from it is the two columns the plain serializers cannot
 * know: when an admin was last seen, and how often that PERSON has signed in
 * (every organization and none — hence Rails' `user_` prefix, which is kept).
 *
 * OPTIONAL on purpose, and the one place in this file that is tolerant. These are
 * decoration on a row whose identity comes from `admins` above; a page that
 * blanked itself because a last-seen column went missing would be trading a
 * working console for a stricter contract. The counts that ARE the page are
 * required, and drift in them is loud.
 */
const reportSchema = z.object({
  admins: z.array(
    adminSchema.extend({
      last_seen_at: timestamp.nullable(),
      user_sign_in_count: count,
      user_sign_in_count_30d: count,
    }),
  ),
  members: z.array(memberSchema.extend({ last_seen_at: timestamp.nullable() })),
});

export type ReportAdmin = z.infer<typeof reportSchema>["admins"][number];
export type ReportMember = z.infer<typeof reportSchema>["members"][number];

export const groupsListSchema = z.object({ groups: z.array(groupRowSchema) });

export const groupDetailSchema = z.object({
  group: groupRowSchema,
  admins: z.array(adminSchema),
  members: z.array(memberSchema),
  rotas: z.array(rotaSchema),
  report: reportSchema.optional(),
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
