import { z } from "zod";

// The shape of GET /api/super_admin/traffic, checked at the boundary.
//
// Parsed rather than cast, for the same reason ./super-admin-overview.ts is:
// this payload is nothing BUT derived numbers — a funnel, a set of rates, a
// weekly series — and a number that quietly becomes `undefined` renders as a
// blank or a zero that looks exactly like a real fact. An operator reading
// "0 covers this week" because Rails renamed a key has been told something
// false. See that file's header for the full argument; this one follows it.
//
// The WORDS that go with these shapes — the step labels, the range picker's
// copy, the leak framing, the week labels — live in src/lib/hq-traffic.ts.
// Shape here, meaning there.
//
// Every list below is copied from `apps/api/app/queries/super_admin/traffic.rb`,
// and super-admin-traffic.test.ts hardcodes that file's own lists beside them so
// a rename or a reorder on the Rails side fails a unit test rather than a page.
//
// Deliberately not `server-only`: it holds no token and no origin, only shapes.

/**
 * The three windows the page offers.
 *
 * MUST stay in step with `SuperAdmin::Traffic::RANGE_DAYS`, whose keys these
 * are. Rails answers 400 `invalid_range` for anything else, so this list is also
 * what keeps a hand-typed `?range=` out of the API.
 */
export const TRAFFIC_RANGES = ["7d", "30d", "90d"] as const;
export type TrafficRange = (typeof TRAFFIC_RANGES)[number];

/** What a bare visit to the page asks for. `SuperAdmin::Traffic::DEFAULT_RANGE`. */
export const DEFAULT_TRAFFIC_RANGE: TrafficRange = "30d";

/**
 * The plan's eight conversion steps, in order.
 *
 * MUST stay in step with `SuperAdmin::Traffic::STEPS`. Order is contractual:
 * `step` in the payload is the 1-based index into this list, and each step's
 * rate is measured against the one above it, so a reordered list would draw a
 * funnel whose arithmetic no longer matches its labels.
 *
 * Steps 3 to 8 carry the same keys as `FUNNEL_STEPS` in
 * ./super-admin-overview.ts, on purpose and by Rails' own design: the overview's
 * "furthest step" for one house and this funnel's counts across all of them are
 * the same ladder counted two ways. src/lib/hq-traffic.ts reuses the overview's
 * labels for those six rather than writing a second set of words for them.
 */
export const TRAFFIC_FUNNEL_STEPS = [
  "landing_views",
  "signed_in",
  "made_house",
  "confirmed_timezone",
  "added_member",
  "started_rota",
  "delivered_text",
  "first_cover",
] as const;
export type TrafficFunnelStep = (typeof TRAFFIC_FUNNEL_STEPS)[number];

/**
 * What each step counts. The unit CHANGES at step 3 and that is the plan's
 * funnel rather than a slip: step 2 counts people who signed in, everything
 * below it counts houses. The page prints the unit on every bar so the change
 * is visible rather than inferred.
 */
export const FUNNEL_UNITS = ["views", "users", "houses"] as const;

/**
 * The kinds of text the product sends, which are the segments of the weekly
 * stacked bars.
 *
 * MUST stay in step with `SmsMessage::KINDS`. Rails builds `texts_by_kind` from
 * that constant, so a fourth kind appears here as a missing key rather than
 * silently falling out of the chart.
 */
export const TEXT_KINDS = ["reminder", "cover_notice", "member_login"] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

/** The weekly series the usage half draws, as the payload spells them. */
export const WEEK_SERIES = [
  "texts_sent",
  "texts_delivered",
  "texts_failed",
  "texts_settled",
  "delivery_rate",
  "covers",
  "active_houses",
  "active_users",
  "members_last_seen",
  "new_houses",
] as const;

// A count Rails produced by counting rows: a whole number, never negative.
const count = z.number().int().nonnegative();
// An ActiveSupport timestamp, e.g. "2026-09-14T09:12:04.000Z". `offset: true`
// accepts "+01:00" as well as "Z"; Rails runs in UTC today, but a schema that
// rejected a legitimate ISO 8601 instant would turn a config change into a
// blank dashboard.
const timestamp = z.iso.datetime({ offset: true });

const funnelStepSchema = z.object({
  /** 1-based position in TRAFFIC_FUNNEL_STEPS; checked against `key` below. */
  step: z.number().int().positive().max(TRAFFIC_FUNNEL_STEPS.length),
  key: z.enum(TRAFFIC_FUNNEL_STEPS),
  unit: z.enum(FUNNEL_UNITS),
  /**
   * False means the step is not measured AT ALL — not that it measured zero.
   * Every step is measured today: step 1 started counting `landing_view` events
   * when https://github.com/bshakr/rota/pull/44 landed them. The flag stays in
   * the payload because it is the invariant the refinement below leans on, and
   * because a step that stops being countable must be able to say so rather
   * than publish a confident zero.
   */
  tracked: z.boolean(),
  count: count.nullable(),
  /**
   * This step as a share of the one above it, at ONE DECIMAL, or null when
   * there is no denominator.
   *
   * NOT capped at 100, and the page must not cap it either. Each step counts
   * arrivals inside one window, so a house made by somebody who signed in last
   * month can carry step 3 above step 2; step 4 does it routinely, because
   * `timezone_confirmed_at` is re-stamped on every settings save. A rate over
   * 100% is a fact about the window, and hiding it would hide the reason the
   * funnel looks odd.
   */
  rate_from_previous: z.number().nullable(),
  /**
   * Rails' own caveat about what this step counted, or null when it needs none.
   * Step 1 always carries one: landing views are posted by the page's own
   * script, so crawlers and clients without JavaScript are missed and the figure
   * undercounts. The page prints it verbatim rather than paraphrasing it.
   */
  note: z.string().nullable(),
});

const weekSchema = z.object({
  /** A Monday, UTC, as a plain date: "2026-09-07". No instant, no zone. */
  week_starting: z.iso.date(),
  texts_sent: count,
  /** Exactly one key per kind, always — Rails builds it from `SmsMessage::KINDS`. */
  texts_by_kind: z.object({
    reminder: count,
    cover_notice: count,
    member_login: count,
  }),
  texts_delivered: count,
  texts_failed: count,
  /** Delivered + failed: the rate's denominator, published beside it. */
  texts_settled: count,
  /**
   * Delivered as a share of settled, at one decimal, or NULL when nothing has
   * settled. Null and 0 are opposite facts — "no texts that week" against "none
   * of them arrived" — so the sparkline draws null as a gap and never as a
   * floor.
   */
  delivery_rate: z.number().nullable(),
  /** The same number as `texts_by_kind.cover_notice`, surfaced as the engagement signal. */
  covers: count,
  active_houses: count,
  /** Everyone signed in that week, including people with no house of their own. */
  active_users: count,
  /**
   * Members whose LAST seen moment falls in this week. A moving column: each
   * member can only ever light up one week, so the series rises towards the
   * present by construction. The page must label it "most recently seen" — see
   * hq-traffic.ts, which owns that word.
   */
  members_last_seen: count,
  new_houses: count,
});

const failuresSchema = z.object({
  /** Every failed text in the range, including the ones that carry no code. */
  total: count,
  /** How many of `total` had no `error_code` at all. */
  uncoded: count,
  /**
   * The five worst codes, worst first. Shares are of `total`, so they visibly
   * do not add up to a hundred — which is the honest way to publish a top five.
   */
  top: z
    .array(
      z.object({
        error_code: z.string(),
        count,
        share: z.number().nullable(),
      }),
    )
    .max(5),
});

export const trafficSchema = z.object({
  range: z.enum(TRAFFIC_RANGES),
  starts_at: timestamp,
  ends_at: timestamp,
  generated_at: timestamp,

  /**
   * All eight steps, always, in ladder order — a step that ever stops being
   * counted is published with a null count rather than omitted, so the page
   * never renumbers the funnel. A short array would mean a step quietly stopped
   * being counted, and a bar that is not there cannot look wrong.
   */
  funnel: z
    .array(funnelStepSchema)
    .length(TRAFFIC_FUNNEL_STEPS.length)
    .superRefine((steps, ctx) => {
      steps.forEach((step, index) => {
        const expected = TRAFFIC_FUNNEL_STEPS[index];
        if (step.key !== expected) {
          ctx.addIssue({
            code: "custom",
            path: [index, "key"],
            message: `is "${step.key}" where the ladder has "${expected}"`,
          });
        }
        if (step.step !== index + 1) {
          ctx.addIssue({
            code: "custom",
            path: [index, "step"],
            message: `says ${step.step} at position ${index + 1} of the ladder`,
          });
        }
        // `tracked` decides whether the page draws a bar or the words "not
        // tracked yet", and `count` is what it draws. A payload where they
        // disagree renders a confident zero-length bar over a step nobody is
        // counting, which looks exactly like a step everybody failed.
        if (step.tracked !== (step.count !== null)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "tracked"],
            message: `is ${step.tracked} but count is ${step.count === null ? "null" : step.count}`,
          });
        }
      });
    }),

  /**
   * Median hours from a first sign-in to that house's first delivered reminder,
   * at one decimal, or null when nobody in the window did both.
   *
   * Survivorship-biased towards the fast, structurally: a house can only be in
   * it once it has actually sent, so houses still stuck in onboarding at the
   * edge of the window are missing rather than dragging it up. Which is why the
   * sample size travels with it and the page always prints both.
   */
  median_hours_to_first_text: z.number().nullable(),
  median_hours_sample: count,

  /** Signed in during the window and has no house at all, as of now. The leak. */
  signed_in_without_house: count,

  /**
   * Every week the window touches, oldest first, zero-filled. A chart with a
   * hole in it reads as missing data rather than as a quiet week.
   */
  weeks: z.array(weekSchema).superRefine((weeks, ctx) => {
    weeks.forEach((week, index) => {
      if (index === 0) return;
      if (week.week_starting > weeks[index - 1].week_starting) return;

      // Every chart on the usage half draws these left to right in array order.
      // A shuffled or duplicated series would render a plausible-looking chart
      // of the wrong weeks, which is the one drift nobody spots by eye.
      ctx.addIssue({
        code: "custom",
        path: [index, "week_starting"],
        message: `${week.week_starting} does not come after ${weeks[index - 1].week_starting}`,
      });
    });
  }),

  failures: failuresSchema,
});

export type SuperAdminTraffic = z.infer<typeof trafficSchema>;
export type TrafficFunnelRow = z.infer<typeof funnelStepSchema>;
export type TrafficWeek = z.infer<typeof weekSchema>;
export type TrafficFailures = z.infer<typeof failuresSchema>;

/**
 * The API answered, but not with the payload this page knows how to read.
 *
 * Its own class, like `OverviewShapeError`, so the page can tell a deploy skew
 * apart from Rails being down: they deserve different words on screen and
 * different follow-up.
 */
export class TrafficShapeError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`The traffic payload did not match the expected shape: ${issues.join("; ")}`);
    this.name = "TrafficShapeError";
    this.issues = issues;
  }
}

export function isTrafficShapeError(value: unknown): value is TrafficShapeError {
  return value instanceof TrafficShapeError;
}

/**
 * Parse a raw traffic response, or throw `TrafficShapeError` naming every field
 * that disagreed. Pure: the caller decides what a failure means on screen.
 */
export function parseTraffic(raw: unknown): SuperAdminTraffic {
  const result = trafficSchema.safeParse(raw);
  if (result.success) return result.data;

  throw new TrafficShapeError(
    result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  );
}
