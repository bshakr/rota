/**
 * The three or four facts about the spend payload that BOTH sides of the client
 * boundary need — and nothing else.
 *
 * A leaf module on purpose, importing nothing. The spend page's margin
 * calculator is a Client Component, and everything it reaches transitively rides
 * into the browser chunk with it. It needs the maths in ./hq-spend.ts, which in
 * turn needs the window keys and the money precision; if those came from
 * ./api/super-admin-spend.ts the whole zod schema — every field, every refinement
 * message, and zod itself — would be bundled behind them, to validate a payload
 * the browser never sees.
 *
 * So the constants live here, ./api/super-admin-spend.ts builds its schema FROM
 * them, and ./hq-spend.ts takes only `import type` from that module. The proof
 * is mechanical rather than a promise: `scripts/assert-token-not-in-bundle.mjs`
 * greps the built client chunks for this schema's own regex message ("is not a
 * YYYY-MM month"), which can only be there if the schema came too.
 *
 * These three are Rails' constants. Where each comes from is on the export.
 */

/**
 * The three windows the spend API offers.
 *
 * MUST stay in step with `SuperAdmin::Spend::RANGE_DAYS`, whose keys these are.
 * Rails answers 400 `invalid_range` for anything else, so this list is also what
 * keeps a hand-typed `?range=` out of the API.
 *
 * They are NOT calendar windows: each is an exact number of days ending now (30,
 * 90, 365), which is why `months_in_range` in the payload is fractional and why
 * the oldest bar of the `months` series is always a partial month.
 */
export const SPEND_RANGES = ["30d", "90d", "12m"] as const;
export type SpendRange = (typeof SPEND_RANGES)[number];

/** What a bare visit to the page asks for. `SuperAdmin::Spend::DEFAULT_RANGE`. */
export const DEFAULT_SPEND_RANGE: SpendRange = "30d";

/**
 * How many decimal places every money figure in the spend payload carries.
 *
 * `SuperAdmin::Spend::MONEY_PRECISION` — six, because that is the precision of
 * the columns the figures are summed from (`ai_calls.cost_usd` is decimal(12,6),
 * `sms_messages.price` decimal(10,5)). A single SMS segment costs under a
 * hundredth of a cent, and at four decimals a real cost rendered as zero.
 *
 * It is here so the renderer in ./hq-spend.ts has ONE number to honour: nothing
 * on the spend page may round a figure below the precision the API computed it
 * at.
 */
export const MONEY_DECIMALS = 6;
