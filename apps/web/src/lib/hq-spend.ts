import type { BarTone } from "@/components/charts/bars";

// TYPES ONLY from the schema module, and that `import type` is load-bearing
// rather than tidy: it is erased at compile, so the margin calculator — a Client
// Component that imports this file for its arithmetic — does not drag the zod
// schema, or zod, into the browser chunk behind it. The values it needs come
// from ./spend-constants, a leaf module. See that file's header, and the
// client-chunk grep in scripts/assert-token-not-in-bundle.mjs that proves it.
import type {
  OverviewSpend,
  SpendFigures,
  SpendHouse,
  SuperAdminSpend,
} from "./api/super-admin-spend";
import {
  DEFAULT_SPEND_RANGE,
  MONEY_DECIMALS,
  SPEND_RANGES,
  type SpendRange,
} from "./spend-constants";
import { formatCount } from "./charts";
import { MONTH_SHORT } from "./date";
import { formatRate, plural } from "./hq-overview";

/**
 * The words, the money and the arithmetic behind HQ's spend page.
 *
 * Its siblings are ./hq-overview.ts and ./hq-traffic.ts, and the division is the
 * same one: shape in ./api/super-admin-spend.ts, MEANING here. If you arrived
 * looking for what a key is called, that is the other file; this one decides
 * what it says and what it is worth.
 *
 * Everything here is pure and takes its inputs as arguments, which is what lets
 * the margin calculator — the one Client Component on the page — import the
 * maths without importing the payload, and what lets every sentence below be
 * tested rather than reviewed by eye.
 *
 * It exists because this is the page where a wrong number is a wrong PRICE.
 * Three rules run through all of it:
 *
 *   1. NEVER ROUND BELOW THE SOURCE. Rails computes every money figure at six
 *      decimals because a single SMS segment costs under a hundredth of a cent
 *      and four decimals reported a real cost as zero. So `formatUsd` prints
 *      every decimal the API sent, down to a floor of two — "$0.0079" is the
 *      cost of a text and "$0.01" is a lie about it. Rates keep one decimal
 *      (project rule, BLO-1454).
 *   2. NULL IS NOT ZERO. A house with nobody left to text has no cost per
 *      member; a window with no texts has no cost per text. Each of those says
 *      so in words. "$0.00" on a cost page is the single most expensive lie this
 *      product can tell.
 *   3. SETTLED IS NOT ESTIMATED. Twilio's price lands minutes after delivery, so
 *      the newest rows are always priced at a list rate. The two are never
 *      blended into one figure without the page saying which is which.
 */

// --- The range picker -------------------------------------------------------

/** What each window is called on the segmented control. */
export const SPEND_RANGE_LABELS: Record<SpendRange, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

/**
 * The `?range=` in the URL, turned into a window the API will accept.
 *
 * Anything unrecognised falls back to the default rather than being forwarded:
 * Rails answers 400 `invalid_range` for a window it does not know, and a
 * hand-edited URL or a stale bookmark should show the operator thirty days, not
 * an error page. Rails keeps its own allowlist regardless — this is the page
 * being forgiving, not the API being loose.
 *
 * Next hands back an array when a parameter is repeated (`?range=30d&range=12m`),
 * which is a thing a link cannot produce and a person can. The first value wins,
 * because that is the one they typed first.
 */
export function parseSpendRange(value: string | string[] | undefined): SpendRange {
  const first = Array.isArray(value) ? value[0] : value;
  const found = SPEND_RANGES.find((range) => range === first);
  return found ?? DEFAULT_SPEND_RANGE;
}

/** The href for a window, so the picker and any deep link agree on one spelling. */
export function spendRangeHref(range: SpendRange): string {
  return `/super-admin/spend?range=${range}`;
}

// --- Money ------------------------------------------------------------------

/**
 * The floor on decimals. Two, so an ordinary figure reads as money rather than
 * as "$17.9"; the ceiling is the API's own `MONEY_DECIMALS`.
 */
export const MIN_MONEY_DECIMALS = 2;

/**
 * Digit grouping, by hand. Never `Intl.NumberFormat`, for the reason lib/date.ts
 * spells out at length — Node's ICU and a browser's ICU ship different CLDR
 * revisions, and a formatter that resolves differently on the two sides of a
 * hydration boundary is a mismatch on every figure the page draws. Counts get
 * the same treatment in `formatCount` (lib/charts.ts); this is the money half,
 * which lives here because the DECIMAL rule below is a money rule.
 */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * A money figure at THE PRECISION THE API SENT IT, between two and six decimals:
 * `0.0079` prints "0.0079", `17.88923` prints "17.88923", `2.5` prints "2.50".
 *
 * Trailing zeros are trimmed down to two and no further, so the common case
 * reads as ordinary money and a sub-cent figure keeps every digit that carries
 * information. Rounding to whole cents is forbidden outright: the cost of one
 * text is $0.0079, and a page that renders that as $0.01 has overstated the
 * product's variable cost by twenty-seven per cent on the figure a price is set
 * against.
 *
 * Negative is a real answer here — the margin calculator subtracts a cost from a
 * candidate price — so the sign is carried, and a value that rounds to nothing
 * loses it rather than printing "-0.00".
 */
export function formatAmount(value: number): string {
  const fixed = Math.abs(value).toFixed(MONEY_DECIMALS);
  const [whole, fraction] = fixed.split(".");

  let end = fraction.length;
  while (end > MIN_MONEY_DECIMALS && fraction[end - 1] === "0") end -= 1;

  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${sign}${group(whole)}.${fraction.slice(0, end)}`;
}

/** `formatAmount` wearing the dollar sign, with the sign outside it: "-$3.20". */
export function formatUsd(value: number): string {
  const amount = formatAmount(value);
  return amount.startsWith("-") ? `-$${amount.slice(1)}` : `$${amount}`;
}

/**
 * A charge in a currency the API refused to convert: "0.324000 GBP".
 *
 * The unit trails the number rather than wearing a symbol, because the page has
 * no symbol table and inventing one is how a Norwegian krone charge gets a pound
 * sign in front of it.
 */
export function formatOtherCurrency(amount: number, unit: string): string {
  return `${formatAmount(amount)} ${unit}`;
}

/** Round to the API's own money precision, which is also where float noise stops. */
export function roundMoney(value: number): number {
  const factor = 10 ** MONEY_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** One decimal, the project's rate precision. */
function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

// --- Months -----------------------------------------------------------------

/**
 * "2026-09" as "Sept 2026".
 *
 * Takes the STRING and never a Date, which is the whole point: `new Date("2026-09")`
 * is midnight UTC on the first, and rendering that instant in a zone behind UTC
 * prints August. A month with no instant behind it is calendar arithmetic, so it
 * is done as calendar arithmetic, off the same frozen en-GB table every other
 * date on the product is rendered from.
 *
 * The year is always printed. A 12-month window draws thirteen bars spanning two
 * calendar years, and "Sept" twice in one chart is worse than four extra
 * characters.
 */
export function monthLabel(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  const index = match ? Number(match[2]) - 1 : -1;
  if (index < 0 || index > 11) throw new RangeError(`Not a calendar month: ${month}`);

  return `${MONTH_SHORT[index]} ${match![1]}`;
}

// --- The monthly stack ------------------------------------------------------

/**
 * The three things a month of spend is made of, in the order they stack.
 *
 * Settled sits against estimated, and Claude sits apart from both — which is the
 * page's whole argument drawn as a chart. Two of these are the same vendor
 * measured two ways, and the legend says so; blending them into one "texts" bar
 * is exactly the silence the plan forbids.
 *
 * The ORDER IS THE ARGUMENT, and it is [settled, estimated, Claude]: the two
 * halves of one vendor's bill sit side by side, so a month reads as "this much
 * of the texts is invoiced, this much is still a guess, and then Claude". Moving
 * Claude between them to separate two pastels would break that reading, and it
 * would not help anyway — the awkward pair travels with them.
 *
 * The tones are the shared chart cuts (./charts/bars.tsx), not the sticker
 * pastels. Run through the dataviz validator, mint against peach scores ΔE 7.7
 * for protanopia — inside the 6-8 band — and it scores that whether they are
 * adjacent or a segment apart, because the deficiency does not care about
 * distance along a bar. So the relief is NOT the order; it is that colour is
 * never the only carrier here. Every row prints its own total AND its per-series
 * split in text, the legend carries each series' total, and the table below holds
 * every number in the chart. A reader who cannot separate the two pastels loses
 * nothing but the glance.
 */
export const SPEND_SERIES: readonly {
  key: "sms_cost_settled" | "sms_cost_estimated" | "claude_cost";
  label: string;
  /** The same series in a running line of figures, where "Texts," is redundant. */
  short: string;
  tone: BarTone;
}[] = [
  { key: "sms_cost_settled", label: "Texts, settled", short: "settled", tone: "grape" },
  { key: "sms_cost_estimated", label: "Texts, estimated", short: "estimated", tone: "peach" },
  { key: "claude_cost", label: "Claude", short: "Claude", tone: "mint" },
];

/**
 * A bucket's three figures as one line of text: "$5.4704 settled · $0.0711
 * estimated · $0.784 Claude".
 *
 * This is what makes the chart above it readable without colour at all. A
 * stacked bar carries three values in three fills; a reader who cannot separate
 * two of those fills — see the note on SPEND_SERIES — otherwise has the row
 * total and no way to know which vendor it went to. Printed, they do.
 */
export function seriesSplitNote(figures: SpendFigures): string {
  return SPEND_SERIES.map((series) => `${formatUsd(figures[series.key])} ${series.short}`).join(
    " · ",
  );
}

/** The three money figures of a bucket, in `SPEND_SERIES` order. */
export function seriesValues(figures: SpendFigures): number[] {
  return SPEND_SERIES.map((series) => figures[series.key]);
}

// --- What the SMS figure can and cannot say ---------------------------------

/**
 * Settled texts as a share of texts sent, at one decimal, or null when nothing
 * was sent.
 *
 * The denominator is `texts_sent` rather than "texts we asked about", because
 * the three counts partition it exactly — that is asserted in the schema — so
 * this is genuinely "how much of the bill is a real invoice line".
 */
export function settledShare(figures: SpendFigures): number | null {
  if (figures.texts_sent === 0) return null;
  return roundRate((figures.texts_settled / figures.texts_sent) * 100);
}

/**
 * The legend's sentence: which rows are a charge, which are a guess, and which
 * will never be anything else.
 *
 * Written out rather than implied by colour, because the difference between a
 * settled price and a list-rate estimate is the difference between a number an
 * operator can put in a spreadsheet and one they cannot.
 */
export function pricingNote(figures: SpendFigures, segmentCost: number): string {
  if (figures.texts_sent === 0) return "No texts were sent in this window, so nothing is priced.";

  const settled = `${formatCount(figures.texts_settled)} of ${formatCount(figures.texts_sent)} texts carry the price Twilio charged (${formatRate(settledShare(figures) ?? 0)}).`;

  const waiting =
    figures.texts_estimated > 0
      ? ` ${formatCount(figures.texts_estimated)} ${plural(figures.texts_estimated, "is", "are")} still estimated at ${formatUsd(segmentCost)} a segment while Twilio settles.`
      : "";

  const never =
    figures.texts_unpriceable > 0
      ? ` ${formatCount(figures.texts_unpriceable)} ${plural(figures.texts_unpriceable, "text is", "texts are")} past Twilio's retention and will stay an estimate for good.`
      : "";

  return `${settled}${waiting}${never}`;
}

/**
 * What the Claude figure is short by, when some calls had no rate to price them.
 *
 * Null when every call was priced, because a line saying "0 calls unpriced" on a
 * healthy month is noise that teaches an operator to skip the line on the month
 * it matters.
 */
export function claudeShortfallNote(figures: SpendFigures): string | null {
  if (figures.claude_calls_unpriced === 0) return null;

  const n = figures.claude_calls_unpriced;
  return `${formatCount(n)} Claude ${plural(n, "call", "calls")} had no rate in the table, so this figure is short by whatever ${plural(n, "it", "they")} cost.`;
}

/**
 * Charges in a currency the API would not convert, as one sentence.
 *
 * Null when there are none. A conversion would need a rate, and a rate is one
 * more thing to be wrong about (the plan's Currency decision), so these sit
 * beside the USD total rather than inside it — and the page has to say so, or
 * the total silently understates the bill.
 */
export function otherCurrenciesNote(figures: SpendFigures): string | null {
  if (figures.sms_cost_other_currencies.length === 0) return null;

  const charges = figures.sms_cost_other_currencies
    .map((charge) => formatOtherCurrency(charge.amount, charge.unit))
    .join(", ");

  return `Twilio also billed ${charges}. Nothing here converts it, so the totals on this page are USD only and the bill is larger than they say.`;
}

/** The per-member cell: a figure, or why there isn't one. Never an em dash. */
export function perActiveMemberNote(house: SpendHouse): string {
  if (house.total_per_active_member === null) return "no active members";
  return formatUsd(house.total_per_active_member);
}

/** "9 housemates" / "nobody on the roll" — the denominator, in words. */
export function activeMembersNote(house: SpendHouse): string {
  if (house.active_members === 0) return "nobody on the roll";
  return `${formatCount(house.active_members)} ${plural(house.active_members, "housemate", "housemates")}`;
}

/**
 * A unit-economics figure, or the reason there isn't one.
 *
 * Every one of them can legitimately have no answer — no houses, no members, no
 * texts — and Rails says nil rather than zero for each. "Not enough data" and
 * "$0.00" are different answers to a pricing question, and only one of them is
 * true.
 */
export function unitFigure(value: number | null): string {
  return value === null ? "not enough data" : formatUsd(value);
}

// --- The overview tile ------------------------------------------------------

/**
 * The window the overview's spend tile reads.
 *
 * Ninety days rather than thirty, and that is the tile's own arithmetic: it
 * shows this month beside LAST month whole, and a 30-day window opened on the
 * 3rd does not reach back far enough to hold one. Ninety always covers at least
 * three calendar months, whatever day it is asked on.
 */
export const OVERVIEW_SPEND_RANGE: SpendRange = "90d";

/**
 * The window one house's card on the group dashboard reads.
 *
 * The plan asks that card for "this month and the last three", and ninety days
 * is the shortest range the picker offers that reaches back that far. Ninety
 * days is not four calendar months, though, and the card must not be described
 * as if it were: counted back from 31 January it reaches 2 November, so the
 * payload carries November, December and January, three buckets. Counted back
 * from the 1st of a month it reaches four. What this window actually shows is
 * this month and up to three before it.
 *
 * It is its own constant rather than a reuse of the overview's: the two
 * surfaces happen to want the same window today and are answering different
 * questions, so one moving must not silently move the other.
 */
export const GROUP_SPEND_RANGE: SpendRange = "90d";

/**
 * The four figures the overview tile renders, derived from the spend payload.
 *
 * `months[-1]` is THIS MONTH SO FAR — the window ends now, so its last calendar
 * bucket is a partial month — and `months[-2]` is the last whole one. The tile
 * must say "so far" about the first and must not compare the two as if they were
 * the same length; see the tile itself for that copy.
 *
 * Null when the payload carries no months at all, which the schema permits and
 * nothing real produces: a window always touches at least one calendar month.
 * The tile falls back to its waiting state rather than rendering four zeroes.
 */
export function overviewSpend(spend: SuperAdminSpend): OverviewSpend | null {
  const thisMonth = spend.months.at(-1);
  if (thisMonth === undefined) return null;

  const lastMonth = spend.months.length >= 2 ? spend.months.at(-2) : undefined;
  const figures = (month: SpendFigures & { month: string }) => ({
    month: month.month,
    sms_cost: month.sms_cost,
    claude_cost: month.claude_cost,
    total: month.total,
  });

  return {
    range: spend.range,
    currency: spend.currency,
    this_month: figures(thisMonth),
    last_month: lastMonth === undefined ? null : figures(lastMonth),
  };
}

// --- The group card ---------------------------------------------------------

/**
 * One house's spend, plus the window it was measured in.
 *
 * `house` is null when the house spent nothing at all in the window: Rails only
 * emits a row for a house that sent a text or made a Claude call, so "absent"
 * means "cost nothing", which is a real and useful thing for a group page to be
 * able to say.
 */
export type HouseSpendWindow = {
  range: SpendRange;
  currency: string;
  /** The calendar months the window touches, oldest first, as "2026-09". */
  months: string[];
  /** The window's true length in average calendar months — the "per month" divisor. */
  monthsInRange: number;
  /** What one unsettled segment is priced at, so the card can say what its estimate assumes. */
  estimatedSegmentCost: number;
  house: SpendHouse | null;
};

/**
 * Filter the whole-product spend payload down to one house.
 *
 * There is NO per-group spend endpoint. `SuperAdmin::Spend` answers for every
 * house at once and is cached for a minute, so one house's figures are read out
 * of the same payload the spend page draws — which is the right trade at tens of
 * houses, and means the group card and the spend page can never disagree about
 * what a house cost.
 *
 * What the payload does NOT carry is a per-house MONTHLY breakdown: `months` is
 * the whole product month by month, and `houses` is each house over the whole
 * window. So the card names the months its figure covers and shows the window
 * total split by vendor, rather than drawing four bars it would have to invent.
 * Splitting a house's spend by month needs an API change, not a web one.
 */
export function houseSpend(spend: SuperAdminSpend, groupId: number): HouseSpendWindow {
  return {
    range: spend.range,
    currency: spend.currency,
    months: spend.months.map((month) => month.month),
    monthsInRange: spend.months_in_range,
    estimatedSegmentCost: spend.sms_estimated_segment_cost_usd,
    house: spend.houses.find((house) => house.group_id === groupId) ?? null,
  };
}

/** "Sept 2026, and the three before it" — the window a group card's figure covers. */
export function monthsCoveredNote(months: readonly string[]): string {
  if (months.length === 0) return "no months";
  if (months.length === 1) return monthLabel(months[0]);

  const earlier = months.length - 1;
  return `${monthLabel(months[months.length - 1])}, and the ${earlier === 1 ? "month" : `${earlier} months`} before it`;
}

// --- The margin calculator --------------------------------------------------

/**
 * What one house's monthly share of the fixed cost is, or null when no fixed
 * cost is configured (or nothing was spent, so there is nobody to divide among).
 *
 * Rails allocates the fixed cost over the WHOLE WINDOW — `allocated_fixed_cost`
 * is the monthly figure times the window's length, split across active houses —
 * so the monthly share is simply the configured figure over the number of houses
 * that spent anything. The same divisor Rails used, which is what keeps this and
 * the table column in step; hq-spend.test.ts pins the two against each other.
 */
export function fixedCostPerHousePerMonth(spend: SuperAdminSpend): number | null {
  if (spend.fixed_monthly_cost_usd === null || spend.houses_with_spend === 0) return null;
  return roundMoney(spend.fixed_monthly_cost_usd / spend.houses_with_spend);
}

/**
 * The whole window's allocated fixed cost: the "Fixed cost share" column added
 * up, which is what a totals row in that column has to say.
 *
 * Summed from the ROWS rather than recomputed as `fixed_monthly × months`, for
 * the same reason the rest of the footer is: a totals row exists so a reader can
 * check that the column above it adds up, and a figure derived a second way
 * cannot do that job. Null when no fixed cost is configured — there is no column
 * to total.
 */
export function allocatedFixedCostTotal(spend: SuperAdminSpend): number | null {
  if (spend.fixed_monthly_cost_usd === null) return null;

  return roundMoney(
    spend.houses.reduce((sum, house) => sum + (house.allocated_fixed_cost ?? 0), 0),
  );
}

/**
 * Every house's VARIABLE cost per month, from the per-house rows.
 *
 * Divided by `months_in_range`, the window's true length — 0.985626 months for a
 * 30-day window, not 1 — because a per-month figure that divides by a convenient
 * integer reads about five per cent low on the 12-month window and nobody would
 * ever notice.
 */
export function houseMonthlyCosts(spend: SuperAdminSpend): number[] {
  return spend.houses.map((house) => roundMoney(house.total / spend.months_in_range));
}

/** A candidate price measured against one monthly cost. */
export type MarginAt = {
  /** The monthly cost this margin is measured against. */
  cost: number;
  /** price - cost. Negative when the house costs more than the price asks for. */
  margin: number;
  /** The margin as a share of the price, at one decimal. Null at a price of zero. */
  rate: number | null;
};

/**
 * The margin a candidate monthly price leaves against one monthly cost.
 *
 * Margin on PRICE, not on cost — that is the convention a subscription business
 * quotes, and the one that stays readable when the cost is a few cents: margin
 * on cost at these numbers is four-figure percentages that say nothing.
 *
 * A price of zero has no margin rate at all (nothing to take a share of) rather
 * than a rate of minus infinity.
 */
export function marginAt(price: number, cost: number): MarginAt {
  const margin = roundMoney(price - cost);
  return { cost, margin, rate: price > 0 ? roundRate((margin / price) * 100) : null };
}

/**
 * How many houses would be loss-making at this price.
 *
 * Strictly greater than: a house that costs exactly the price is breaking even,
 * not losing money. The count is drawn from the per-house rows rather than from
 * the percentiles, because "the median house is profitable" and "every house is
 * profitable" are very different facts and only one of them is a plan.
 */
export function lossMakingCount(price: number, costs: readonly number[]): number {
  return costs.filter((cost) => cost > price).length;
}

/**
 * Everything the margin calculator needs, as plain numbers.
 *
 * A struct rather than the payload, and that is a boundary and not a
 * convenience: the calculator is the one Client Component on this page, and
 * bundle-safety.test.ts refuses a Client Component that imports anything under
 * `lib/api/super-admin`. So the server derives these six figures and hands them
 * over, and the typing itself happens against numbers that are already in the
 * browser — no round trip per keystroke, and no payload in the bundle.
 */
export type MarginInputs = {
  /** The API's own per-house-per-month percentiles. Null when no house spent anything. */
  medianCost: number | null;
  p90Cost: number | null;
  /** Every house's variable cost per month, for the loss-making count. */
  monthlyCosts: number[];
  housesMeasured: number;
  /** One house's monthly share of the fixed cost, or null when none is configured. */
  fixedPerHousePerMonth: number | null;
};

export function marginInputs(spend: SuperAdminSpend): MarginInputs {
  return {
    medianCost: spend.unit_economics.cost_per_house_per_month.median,
    p90Cost: spend.unit_economics.cost_per_house_per_month.p90,
    monthlyCosts: houseMonthlyCosts(spend),
    housesMeasured: spend.unit_economics.houses_measured,
    fixedPerHousePerMonth: fixedCostPerHousePerMonth(spend),
  };
}

export type MarginSummary = {
  price: number;
  withFixedCost: boolean;
  /** Null when there are no houses to take a percentile of. */
  median: MarginAt | null;
  p90: MarginAt | null;
  lossMaking: number;
  housesMeasured: number;
  /** The monthly fixed share folded in, or null when none is configured. */
  fixedPerHousePerMonth: number | null;
};

/**
 * The whole calculator: what a candidate monthly price leaves at the median
 * house and at the ninetieth percentile, and how many houses it would not cover.
 *
 * The percentiles are the API's own (`unit_economics.cost_per_house_per_month`),
 * not recomputed here, so the calculator and the tiles above it can never quote
 * two different medians.
 *
 * `withFixedCost` adds each house's share of hosting, WorkOS and the Twilio
 * number rental. It is a choice and not a default because the two answer
 * different questions: variable cost alone is what one more house costs, and
 * variable plus allocated is what one house has to earn. A subscription has to
 * cover the second.
 *
 * Adding it does not move WHICH house sits at a percentile — Rails allocates the
 * same figure to every house — so it is added to the percentile cost directly
 * rather than by re-ranking. hq-spend.test.ts holds that reasoning to account
 * against the per-house rows.
 */
export function marginSummary(
  inputs: MarginInputs,
  price: number,
  { withFixedCost = false }: { withFixedCost?: boolean } = {},
): MarginSummary {
  const fixed = withFixedCost ? (inputs.fixedPerHousePerMonth ?? 0) : 0;
  const at = (value: number | null) =>
    value === null ? null : marginAt(price, roundMoney(value + fixed));

  return {
    price,
    withFixedCost,
    median: at(inputs.medianCost),
    p90: at(inputs.p90Cost),
    lossMaking: lossMakingCount(
      price,
      inputs.monthlyCosts.map((cost) => roundMoney(cost + fixed)),
    ),
    housesMeasured: inputs.housesMeasured,
    fixedPerHousePerMonth: inputs.fixedPerHousePerMonth,
  };
}

/**
 * The calculator's headline sentence: how many houses this price would not
 * cover.
 *
 * "None" is said in words rather than as a zero, because the zero an operator
 * most wants to see is also the one that looks most like a missing figure.
 */
export function lossMakingNote(summary: MarginSummary): string {
  if (summary.housesMeasured === 0) return "No house has spent anything in this window yet.";
  if (summary.lossMaking === 0) {
    return `This price covers every one of the ${formatCount(summary.housesMeasured)} ${plural(summary.housesMeasured, "house", "houses")} measured.`;
  }

  return `${formatCount(summary.lossMaking)} of ${formatCount(summary.housesMeasured)} ${plural(summary.housesMeasured, "house", "houses")} would lose money at this price.`;
}

/**
 * A typed price, turned into a number the calculator can use.
 *
 * The field is free text on purpose (a number input still hands back a string),
 * and an operator halfway through typing "4." must not blank the whole panel.
 * Anything that is not a non-negative finite number is null, and the panel says
 * "type a price" rather than rendering a margin against NaN.
 */
export function parseCandidatePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;

  return roundMoney(value);
}
