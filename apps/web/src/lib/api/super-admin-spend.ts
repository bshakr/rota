import { z } from "zod";

import { SPEND_RANGES } from "../spend-constants";

// The shape of GET /api/super_admin/spend, checked at the boundary.
//
// Parsed rather than cast, for the same reason ./super-admin-overview.ts and
// ./super-admin-traffic.ts are: this payload is nothing BUT money and derived
// counts, and a figure that quietly becomes `undefined` renders as a blank or a
// zero that looks exactly like a real fact. On THIS page that fact is a price.
// An operator who sets a subscription against a total that lost its Claude
// column has been told something false in the most expensive possible way.
//
// The WORDS that go with these shapes — the range labels, the settled-versus-
// estimated legend, the margin calculator, every money string — live in
// src/lib/hq-spend.ts. Shape here, meaning there; if you arrived looking for how
// a figure is rendered, that is where it went.
//
// Every list below is copied from `apps/api/app/queries/super_admin/spend.rb`,
// and super-admin-spend.test.ts hardcodes that file's own key lists beside them
// so a rename on the Rails side fails a unit test rather than a page.
//
// Deliberately not `server-only`: it holds no token and no origin, only shapes.
// Note that bundle-safety.test.ts matches `lib/api/super-admin` as a prefix, so
// a Client Component importing this module trips that guard. That is the right
// answer anyway — the payload is fetched, parsed and rendered on the server, and
// the one Client Component on the spend page (the margin calculator) is handed
// plain numbers rather than the payload.

// The window keys, the default and the money precision are in ../spend-constants.ts,
// a leaf module both this file and the Client Component side import. See its
// header: the margin calculator needs them, and reaching them through this file
// would bundle the schema below — and zod — into the browser to validate a
// payload the browser never sees.

/** A count Rails produced by counting rows: a whole number, never negative. */
const count = z.number().int().nonnegative();

/**
 * A money figure, as the JSON number Rails rendered at six decimals.
 *
 * NOT `.nonnegative()`, on purpose. Nothing in the query can produce a negative
 * total today, but a Twilio credit or an adjustment one day could, and a schema
 * that blanked the whole spend page over a refund would be a worse failure than
 * a minus sign in a table. Sign is the renderer's problem, not the parser's.
 *
 * A money field arriving as a STRING is still refused: `BigDecimal` serialises
 * as a string through Rails' encoder and the query converts deliberately at the
 * last step, so a string here means that conversion was dropped and every
 * arithmetic downstream would silently turn into string concatenation.
 */
const money = z.number();
const nullableMoney = money.nullable();

// An ActiveSupport timestamp, e.g. "2026-09-14T09:12:04.000Z". `offset: true`
// accepts "+01:00" as well as "Z"; Rails runs in UTC today, but a schema that
// rejected a legitimate ISO 8601 instant would turn a config change into a
// blank dashboard.
const timestamp = z.iso.datetime({ offset: true });

/**
 * A currency Rails could not add into the USD total, carried beside it
 * unconverted. Empty in the normal case; see the plan's "Currency" decision.
 */
const otherCurrencySchema = z.object({
  /** An ISO 4217 unit as Twilio spelled it, upper-cased by the query: "GBP". */
  unit: z.string(),
  amount: money,
});

/**
 * The block of figures Rails renders for ANY bucket of spend — the whole range,
 * one month, one house. `SuperAdmin::Spend#figures` builds all three from one
 * method, so one schema covers all three and they cannot drift apart.
 *
 * The three text counts partition `texts_sent` exactly:
 * `texts_settled + texts_estimated + texts_unpriceable == texts_sent`. That
 * invariant is what lets the page say "N of M priced" without inventing a
 * denominator, so it is asserted below rather than assumed.
 */
const figuresShape = {
  /** Texts Twilio ACCEPTED and therefore billed for — not texts a handset received. */
  texts_sent: count,
  segments: count,
  /** Twilio has answered with a price for these. The charge. */
  texts_settled: count,
  sms_cost_settled: money,
  /** Not asked yet: an estimate now, a real price later. */
  texts_estimated: count,
  /** Asked, and no answer is ever coming — past Twilio's retention. Estimated for good. */
  texts_unpriceable: count,
  sms_cost_estimated: money,
  /** Settled plus estimated. Published so the page never adds the two itself. */
  sms_cost: money,
  /** Charges Rails refused to convert into the USD total. Usually empty. */
  sms_cost_other_currencies: z.array(otherCurrencySchema),
  claude_calls: count,
  claude_tokens_in: count,
  claude_tokens_out: count,
  claude_cost: money,
  /** Calls whose model was missing from the rate table, so the cost is short by these. */
  claude_calls_unpriced: count,
  titles_classified: count,
  /** SMS settled + SMS estimated + Claude. Never includes the allocated fixed cost. */
  total: money,
};

/**
 * The legend's whole sentence is "N of M settled, K still estimated, J will never
 * be priced". If those three stopped partitioning the texts sent, that sentence
 * would still render — with numbers that do not add up and nothing on screen to
 * say so. Asserted on every bucket, because Rails builds all three from one
 * method and a drift would hit all three at once.
 */
function assertTextsPartition(
  figures: {
    texts_sent: number;
    texts_settled: number;
    texts_estimated: number;
    texts_unpriceable: number;
  },
  ctx: z.RefinementCtx,
) {
  const parts = figures.texts_settled + figures.texts_estimated + figures.texts_unpriceable;
  if (parts === figures.texts_sent) return;

  ctx.addIssue({
    code: "custom",
    path: ["texts_sent"],
    message:
      `is ${figures.texts_sent}, but settled + estimated + unpriceable is ${parts} ` +
      "— the three no longer partition the texts sent",
  });
}

const figuresSchema = z.object(figuresShape).superRefine(assertTextsPartition);

const monthSchema = z
  .object({
    ...figuresShape,
    /** The UTC calendar month, as "2026-09". */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "is not a YYYY-MM month"),
    /** The first of that month, as a plain date: "2026-09-01". No instant, no zone. */
    starts_on: z.iso.date(),
  })
  .superRefine(assertTextsPartition);

const houseSchema = z
  .object({
    ...figuresShape,
    group_id: z.number().int().positive(),
    name: z.string(),
    slug: z.string(),
    /** On the roll and not opted out, counted NOW rather than historically. */
    active_members: count,
    /**
     * `total` divided by `active_members`, or NULL when the house has nobody left
     * to text. Null is not zero and must never render as a money figure: dividing
     * by nobody has no answer, and "$0.00 per person" would read as a free house.
     */
    total_per_active_member: nullableMoney,
    /**
     * This house's share of `FIXED_MONTHLY_COST_USD` over the window, split evenly
     * across the houses that spent anything. NULL when no fixed cost is configured
     * — the plan's "Fixed costs" decision: unset means no line at all, because a
     * zero there would read as "hosting is free".
     *
     * Its own column and never folded into `total`: it is an allocation, not a
     * charge this house incurred.
     */
    allocated_fixed_cost: nullableMoney,
  })
  .superRefine(assertTextsPartition);

/**
 * Nearest-rank percentiles across houses, so every figure quoted is a house that
 * actually exists rather than an interpolation between two.
 *
 * Both are null when there is nothing to measure. "No houses" and "houses that
 * cost nothing" are different answers to a pricing question.
 */
const percentilesSchema = z.object({
  median: nullableMoney,
  p90: nullableMoney,
});

const unitEconomicsSchema = z.object({
  cost_per_house_per_month: percentilesSchema,
  cost_per_active_member_per_month: percentilesSchema,
  /** Null when no text was sent in the window — never 0, which would mean "texts are free". */
  cost_per_text_sent: nullableMoney,
  /** Null when nothing was classified. */
  cost_per_title_classified: nullableMoney,
  /** How many houses the percentiles above walked. */
  houses_measured: count,
  /** Of those, how many had anybody left to divide by. The per-member spread's n. */
  houses_with_active_members: count,
});

export const spendSchema = z.object({
  range: z.enum(SPEND_RANGES),
  /** "USD". Both vendors bill in it and nothing converts; see the plan's Currency decision. */
  currency: z.string(),
  starts_at: timestamp,
  ends_at: timestamp,

  /**
   * The window's TRUE length in average calendar months, fractional: 30 days is
   * 0.985626, not 1.
   *
   * Deliberately not `months.length`, and the two disagree. This is the divisor
   * behind every "per month" figure and the multiplier behind the allocated
   * fixed cost; `months` below is the calendar series the bars draw. Anything
   * asking "how long am I looking at" wants this; anything drawing bars wants
   * that array. The margin calculator divides by this one.
   */
  months_in_range: z.number().positive(),

  /** `FIXED_MONTHLY_COST_USD`, or null when the operator has not set one. */
  fixed_monthly_cost_usd: nullableMoney,
  /** What one unsettled segment is priced at while Twilio has not answered. */
  sms_estimated_segment_cost_usd: money,

  /** Houses that spent (or tried to spend) anything in the window. */
  houses_with_spend: count,
  /** Every house on the product, spending or not — the denominator for the above. */
  houses_total: count,

  totals: figuresSchema,

  /**
   * Every calendar month the window touches, oldest first, including the ones
   * nothing happened in. A bar chart with a hole in it reads as missing data
   * rather than as a quiet month.
   *
   * Order is contractual: the overview tile reads the LAST entry as "this month
   * so far" and the one before it as "last month, whole", and the page draws
   * them left to right in array order. A shuffled series would render a
   * plausible-looking chart of the wrong months, which is the one drift nobody
   * spots by eye.
   */
  months: z.array(monthSchema).superRefine((months, ctx) => {
    months.forEach((month, index) => {
      if (index === 0) return;
      if (month.month > months[index - 1].month) return;

      ctx.addIssue({
        code: "custom",
        path: [index, "month"],
        message: `${month.month} does not come after ${months[index - 1].month}`,
      });
    });
  }),

  /** One row per house that spent anything, sorted by total spend, dearest first. */
  houses: z.array(houseSchema),

  unit_economics: unitEconomicsSchema,
});

export type SuperAdminSpend = z.infer<typeof spendSchema>;
export type SpendFigures = z.infer<typeof figuresSchema>;
export type SpendMonth = z.infer<typeof monthSchema>;
export type SpendHouse = z.infer<typeof houseSchema>;
export type SpendPercentiles = z.infer<typeof percentilesSchema>;
export type SpendUnitEconomics = z.infer<typeof unitEconomicsSchema>;
export type SpendOtherCurrency = z.infer<typeof otherCurrencySchema>;

/**
 * What the OVERVIEW's spend tile renders: this month so far, split texts and
 * Claude, next to last month's total.
 *
 * A shape rather than an endpoint, and that is the point of it. The figures are
 * derived on the overview page today from `getSpend("90d")` — `months[-1]` and
 * `months[-2]` (see `overviewSpend` in src/lib/hq-spend.ts) — because the tile
 * needs four numbers and a whole second query object would be a second place for
 * "what did September cost" to be answered.
 *
 * It is exported from THIS file, and the overview's own `spend` key is typed as
 * this-or-null, so that the day Rails inlines these four numbers into
 * /api/super_admin/overview the page reads them without a second type, and until
 * then the null branch keeps drawing the waiting state.
 */
export const overviewSpendSchema = z.object({
  /** The window these figures were derived from, so the tile can link to it. */
  range: z.enum(SPEND_RANGES),
  currency: z.string(),
  this_month: z.object({
    month: z.string(),
    sms_cost: money,
    claude_cost: money,
    total: money,
  }),
  /**
   * The whole month before it, or NULL when the window does not reach back far
   * enough to hold one (a first month on the product, or a range shorter than
   * the days elapsed this month). Null is "no month to compare with", which the
   * tile says in words rather than drawing as a zero.
   */
  last_month: z
    .object({
      month: z.string(),
      sms_cost: money,
      claude_cost: money,
      total: money,
    })
    .nullable(),
});

export type OverviewSpend = z.infer<typeof overviewSpendSchema>;
export type OverviewSpendMonth = OverviewSpend["this_month"];

/**
 * The API answered, but not with the payload this page knows how to read.
 *
 * Its own class, like `OverviewShapeError` and `TrafficShapeError`, so the page
 * can tell a deploy skew apart from Rails being down: they deserve different
 * words on screen and different follow-up.
 */
export class SpendShapeError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`The spend payload did not match the expected shape: ${issues.join("; ")}`);
    this.name = "SpendShapeError";
    this.issues = issues;
  }
}

export function isSpendShapeError(value: unknown): value is SpendShapeError {
  return value instanceof SpendShapeError;
}

/**
 * Parse a raw spend response, or throw `SpendShapeError` naming every field that
 * disagreed. Pure: the caller decides what a failure means on screen.
 */
export function parseSpend(raw: unknown): SuperAdminSpend {
  const result = spendSchema.safeParse(raw);
  if (result.success) return result.data;

  throw new SpendShapeError(
    result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  );
}
