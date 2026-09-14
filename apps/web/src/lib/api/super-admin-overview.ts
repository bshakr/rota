import { z } from "zod";

import { overviewSpendSchema } from "./super-admin-spend";

// The shape of GET /api/super_admin/overview, checked at the boundary.
//
// Every other client in this folder CASTS its response (`requestJson<T>`), which
// is fine for a payload one screen renders straight back out: a wrong field is a
// wrong word on the page, visible the moment anyone looks. This one is different.
// It is nothing BUT derived numbers — a delivery rate, a queue depth, how far a
// house got — and a number that quietly becomes `undefined` renders as a blank
// or a zero that looks exactly like a real fact. An operator reading "0 failures"
// because Rails renamed a key has been told something false.
//
// So the payload is PARSED rather than asserted, and the parse is strict in the
// ways that matter: the three key unions (attention reasons, funnel steps, job
// names) come straight from `apps/api/app/queries/super_admin/overview.rb`, and
// super-admin-overview.test.ts hardcodes that file's lists so a rename on the
// Rails side fails a unit test rather than a page.
//
// Unknown keys are stripped, not rejected (zod's default): Rails ADDING a key is
// not a reason to blank this screen, and the next ticket that renders it will add
// it here. It is a key that goes MISSING, or changes type, that this catches.
//
// The WORDS that go with these shapes — the labels, the pills, the staleness
// cadences, the rate formatting — live in src/lib/hq-overview.ts. Shape here,
// meaning there; if you arrived at this file looking for the copy, that is where
// it went.
//
// Deliberately not `server-only` — it holds no token and no origin, only shapes.
// Note that bundle-safety.test.ts matches `lib/api/super-admin` as a prefix, so a
// Client Component importing this module trips that guard. That is the right
// answer anyway: the payload is fetched, parsed and rendered on the server, and a
// client component that wants a piece of it should be handed the piece.

/**
 * Why a house is on the attention list, in the order the API emits them.
 *
 * MUST stay in step with `SuperAdmin::Overview::REASONS`. A house appears once,
 * under the first reason it qualifies for.
 */
export const ATTENTION_REASONS = [
  "failed_texts",
  "unconfirmed_timezone",
  "only_draft_rotas",
  "opted_out_member",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/**
 * The onboarding ladder, lowest rung first.
 *
 * MUST stay in step with `SuperAdmin::Overview::FUNNEL_STEPS`. These are steps 3
 * to 8 of the plan's eight-step funnel. Step 1 (landing views) needs the
 * `page_views` table that is Phase 5. Step 2 (signed in) IS tracked —
 * https://linear.app/bloombase/issue/BLO-1671 landed `sign_ins` — but this query
 * does not join it, because a house's furthest rung is asked of the house and a
 * sign-in belongs to a person who may not have one yet; that funnel is the
 * traffic query's job (https://linear.app/bloombase/issue/BLO-1681). So both are
 * absent from THIS payload rather than guessed at, and the page says so rather
 * than renumbering the ladder.
 */
export const FUNNEL_STEPS = [
  "made_house",
  "confirmed_timezone",
  "added_member",
  "started_rota",
  "delivered_text",
  "first_cover",
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * The recurring jobs the health tile watches, in the order it lists them.
 *
 * MUST stay in step with `JobRun::MONITORED`, which is itself spelled exactly as
 * the keys of `apps/api/config/recurring.yml` — so "which job is this row?" is
 * answered by reading the schedule file, with nothing translated in between.
 */
export const JOB_NAMES = ["reminder_sweep", "top_up_shift_windows", "sync_house_calendars"] as const;
export type JobName = (typeof JOB_NAMES)[number];

// A count Rails produced by counting rows: a whole number, never negative.
const count = z.number().int().nonnegative();
// An ActiveSupport timestamp, e.g. "2026-09-13T09:12:04.000Z". Kept as the string
// Rails sent and turned into a Date where it is rendered, exactly as the SMS log
// and the shift screens do — a schema that returns Dates would make the parsed
// payload unserialisable across an RSC boundary.
//
// `offset: true` accepts "+01:00" as well as "Z". Rails runs in UTC today
// (config.time_zone) so every one of these ends in Z, but a schema that rejects a
// legitimate ISO 8601 instant would turn a config change into a blank dashboard.
const timestamp = z.iso.datetime({ offset: true });

const kpisSchema = z.object({
  houses_total: count,
  houses_active_last_30_days: count,
  houses_new_this_week: count,
  texts_last_7_days: count,
  texts_delivered_last_7_days: count,
  texts_failed_last_7_days: count,
  /** Delivered + failed: the rate's denominator, published beside it. */
  texts_settled_last_7_days: count,
  /**
   * Delivered as a percentage of settled, at ONE DECIMAL, or null when nothing
   * has settled. Null and 0 are opposite facts ("no texts yet" versus "none of
   * them arrived") and the page must never render them the same way.
   */
  delivery_rate_last_7_days: z.number().nullable(),
  covers_this_week: count,
});

const attentionRowSchema = z.object({
  group_id: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
  reason: z.enum(ATTENTION_REASONS),
  /**
   * How many of the thing the reason names — failed texts, empty rotas, opted-out
   * housemates. Null for `unconfirmed_timezone`, where the fact is the whole
   * story and there is nothing to count.
   */
  count: count.nullable(),
});

const recentHouseSchema = z
  .object({
    group_id: z.number().int().positive(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    timezone_confirmed: z.boolean(),
    created_at: timestamp,
    furthest_step: z.enum(FUNNEL_STEPS),
    /**
     * 1-based within FUNNEL_STEPS, so the page draws six pips without owning the
     * list. Bounded by the ladder's length: a seventh rung would draw a pip that
     * is not there.
     */
    furthest_step_number: z.number().int().positive().max(FUNNEL_STEPS.length),
  })
  // The step and its number are TWO renderings of one fact — the pips are drawn
  // from the number, the caption from the step — so a payload where they
  // disagree would draw four filled pips over the words "a reminder arrived" and
  // look entirely plausible. Rails derives one from the other
  // (`FUNNEL_STEPS.index(step) + 1`); this is the assertion that it still does.
  .superRefine((house, ctx) => {
    const expected = FUNNEL_STEPS.indexOf(house.furthest_step) + 1;
    if (house.furthest_step_number === expected) return;

    ctx.addIssue({
      code: "custom",
      path: ["furthest_step_number"],
      message:
        `disagrees with furthest_step: "${house.furthest_step}" is rung ${expected}, ` +
        `not ${house.furthest_step_number}`,
    });
  });

const jobHealthSchema = z.object({
  name: z.enum(JOB_NAMES),
  /** Null means the job has never finished a pass — the loudest thing this tile says. */
  last_finished_at: timestamp.nullable(),
  succeeded: z.boolean().nullable(),
  error_class: z.string().nullable(),
});

const systemHealthSchema = z.object({
  /**
   * Exactly one row per monitored job, always. Rails builds this by mapping
   * `JobRun::MONITORED`, so a name with no runs behind it still appears (reported
   * as "never finished", which for something scheduled hourly is the loudest
   * thing this tile can say). A SHORT array would therefore mean a job quietly
   * stopped being monitored — and the tile would render as if all were well,
   * because a row that is not there cannot look wrong. Pinning the length is what
   * makes that visible.
   */
  jobs: z.array(jobHealthSchema).length(JOB_NAMES.length),
  /**
   * Solid Queue lives in its own database, so this one figure can fail on its own
   * and arrive null. That is "we could not ask", not "there are none".
   */
  queue_failed_executions: count.nullable(),
});

export const overviewSchema = z.object({
  generated_at: timestamp,
  kpis: kpisSchema,
  /** Capped at 50 by the API; `attention_total` is the count before the cap. */
  attention: z.array(attentionRowSchema),
  attention_total: count,
  recent_houses: z.array(recentHouseSchema),
  system_health: systemHealthSchema,
  /**
   * The spend tile's four figures, or null.
   *
   * This key used to be `z.null()`, a deliberate tripwire: the ticket that
   * filled it had to widen the schema and build the tile in the same change,
   * rather than let the page go on saying "spend arrives later" while real money
   * sat in the payload. https://linear.app/bloombase/issue/BLO-1684 is that
   * ticket, and this is the widening.
   *
   * Rails still sends null — `SuperAdmin::Overview` keeps its `spend: nil`
   * placeholder — and the tile still draws its waiting state for it. What
   * changed is where the figures come from: the overview PAGE now calls
   * `getSpend("90d")` alongside `getOverview()` and derives the tile from
   * `months[-1]` and `months[-2]` (see `overviewSpend` in src/lib/hq-spend.ts),
   * because the tile needs four numbers and a second query object would be a
   * second place for "what did September cost" to be answered.
   *
   * The union is what makes that reversible. The day Rails inlines those four
   * figures into this payload, the page reads them here with no new type and no
   * second round trip; until then null keeps meaning "ask the spend endpoint".
   * `overviewSpendSchema` lives beside the spend payload's own shapes, in
   * ./super-admin-spend.ts, so there is one definition of what the tile renders.
   */
  spend: overviewSpendSchema.nullable(),
});

export type SuperAdminOverview = z.infer<typeof overviewSchema>;
export type OverviewKpis = z.infer<typeof kpisSchema>;
export type AttentionRow = z.infer<typeof attentionRowSchema>;
export type RecentHouse = z.infer<typeof recentHouseSchema>;
export type JobHealth = z.infer<typeof jobHealthSchema>;
export type SystemHealth = z.infer<typeof systemHealthSchema>;

/**
 * The API answered, but not with the payload this page knows how to read.
 *
 * Its own class so the page can tell it apart from an `ApiError`: one means Rails
 * refused or fell over, the other means Rails and this page disagree about the
 * shape — a deploy skew, or a rename that only landed on one side. They deserve
 * different words on screen and different follow-up.
 */
export class OverviewShapeError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`The overview payload did not match the expected shape: ${issues.join("; ")}`);
    this.name = "OverviewShapeError";
    this.issues = issues;
  }
}

export function isOverviewShapeError(value: unknown): value is OverviewShapeError {
  return value instanceof OverviewShapeError;
}

/**
 * Parse a raw overview response, or throw `OverviewShapeError` naming every field
 * that disagreed. Pure: the caller decides what a failure means on screen.
 */
export function parseOverview(raw: unknown): SuperAdminOverview {
  const result = overviewSchema.safeParse(raw);
  if (result.success) return result.data;

  throw new OverviewShapeError(
    result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  );
}
