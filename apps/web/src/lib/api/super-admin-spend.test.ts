import { describe, expect, it } from "vitest";

import { emptySpendPayload, spendPayload as payload } from "@/test/spend-payload";

import { DEFAULT_SPEND_RANGE, MONEY_DECIMALS, SPEND_RANGES } from "../spend-constants";

import {
  SpendShapeError,
  isSpendShapeError,
  overviewSpendSchema,
  parseSpend,
  spendSchema,
} from "./super-admin-spend";

// The payload's keys and unions, copied BY HAND from the Rails source that emits
// them: apps/api/app/queries/super_admin/spend.rb.
//
//   RANGE_DAYS      = { "30d" => 30, "90d" => 90, "12m" => 365 }
//   DEFAULT_RANGE   = "30d"
//   MONEY_PRECISION = 6
//
//   #call      -> range, currency, starts_at, ends_at, months_in_range,
//                 fixed_monthly_cost_usd, sms_estimated_segment_cost_usd,
//                 houses_with_spend, houses_total, totals, months, houses,
//                 unit_economics
//   #figures   -> texts_sent, segments, texts_settled, sms_cost_settled,
//                 texts_estimated, texts_unpriceable, sms_cost_estimated,
//                 sms_cost, sms_cost_other_currencies, claude_calls,
//                 claude_tokens_in, claude_tokens_out, claude_cost,
//                 claude_calls_unpriced, titles_classified, total
//   #month_rows-> month, starts_on, + #figures
//   #house_row -> group_id, name, slug, + #figures, active_members,
//                 total_per_active_member, allocated_fixed_cost
//   #unit_economics -> cost_per_house_per_month, cost_per_active_member_per_month,
//                 cost_per_text_sent, cost_per_title_classified, houses_measured,
//                 houses_with_active_members
//
// Hardcoded rather than read off disk on purpose. The point is not to re-derive
// the lists — it is that nobody can add, rename or drop a key on this side
// without editing this copy of the Ruby beside it, which means opening the Ruby.
// A key that goes missing on a page of money does not render as a blank; it
// renders as a smaller number.
const RUBY_RANGES = ["30d", "90d", "12m"];
const RUBY_DEFAULT_RANGE = "30d";
const RUBY_MONEY_PRECISION = 6;

const RUBY_TOP_LEVEL_KEYS = [
  "range",
  "currency",
  "starts_at",
  "ends_at",
  "months_in_range",
  "fixed_monthly_cost_usd",
  "sms_estimated_segment_cost_usd",
  "houses_with_spend",
  "houses_total",
  "totals",
  "months",
  "houses",
  "unit_economics",
];

const RUBY_FIGURE_KEYS = [
  "texts_sent",
  "segments",
  "texts_settled",
  "sms_cost_settled",
  "texts_estimated",
  "texts_unpriceable",
  "sms_cost_estimated",
  "sms_cost",
  "sms_cost_other_currencies",
  "claude_calls",
  "claude_tokens_in",
  "claude_tokens_out",
  "claude_cost",
  "claude_calls_unpriced",
  "titles_classified",
  "total",
];

const RUBY_MONTH_KEYS = ["month", "starts_on", ...RUBY_FIGURE_KEYS];

const RUBY_HOUSE_KEYS = [
  "group_id",
  "name",
  "slug",
  ...RUBY_FIGURE_KEYS,
  "active_members",
  "total_per_active_member",
  "allocated_fixed_cost",
];

const RUBY_UNIT_ECONOMICS_KEYS = [
  "cost_per_house_per_month",
  "cost_per_active_member_per_month",
  "cost_per_text_sent",
  "cost_per_title_classified",
  "houses_measured",
  "houses_with_active_members",
];

/** Every key the schema actually keeps, since zod strips the ones it does not know. */
function keptKeys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

describe("the spend payload's keys, against spend.rb", () => {
  const parsed = parseSpend(payload());

  it("keeps every top-level key the query renders, and no other", () => {
    expect(keptKeys(parsed)).toEqual([...RUBY_TOP_LEVEL_KEYS].sort());
  });

  it("keeps every figure #figures renders, in the range totals", () => {
    expect(keptKeys(parsed.totals)).toEqual([...RUBY_FIGURE_KEYS].sort());
  });

  // One Ruby method builds all three blocks, so a key dropped here would be
  // dropped from all three at once — and a total that is quietly short is the
  // one drift nobody spots by eye.
  it("keeps every key a month row renders", () => {
    expect(keptKeys(parsed.months[0])).toEqual([...RUBY_MONTH_KEYS].sort());
  });

  it("keeps every key a house row renders", () => {
    expect(keptKeys(parsed.houses[0])).toEqual([...RUBY_HOUSE_KEYS].sort());
  });

  it("keeps every unit economics key", () => {
    expect(keptKeys(parsed.unit_economics)).toEqual([...RUBY_UNIT_ECONOMICS_KEYS].sort());
  });

  it("offers exactly the windows Rails accepts, in Rails' order", () => {
    expect([...SPEND_RANGES]).toEqual(RUBY_RANGES);
    expect(DEFAULT_SPEND_RANGE).toBe(RUBY_DEFAULT_RANGE);
  });

  it("agrees with Rails about how many decimals a money figure carries", () => {
    expect(MONEY_DECIMALS).toBe(RUBY_MONEY_PRECISION);
  });
});

describe("parseSpend", () => {
  it("accepts the payload Rails renders", () => {
    const spend = parseSpend(payload());

    expect(spend.range).toBe("90d");
    expect(spend.houses).toHaveLength(4);
    expect(spend.months.map((month) => month.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  // The whole reason this file exists. Rails computes money at six decimals
  // because one SMS segment costs under a hundredth of a cent; a client that
  // coerced these to two would report the product's variable cost wrong on the
  // one page where that figure becomes a price.
  it("carries money through at the six decimals Rails sent, unrounded", () => {
    const spend = parseSpend(payload());

    expect(spend.sms_estimated_segment_cost_usd).toBe(0.0079);
    expect(spend.totals.total).toBe(17.88923);
    expect(spend.totals.claude_cost).toBe(2.13663);
    expect(spend.houses[0].total_per_active_member).toBe(1.234681);
    expect(spend.houses[0].allocated_fixed_cost).toBe(31.04723);
    expect(spend.unit_economics.cost_per_text_sent).toBe(0.007924);
    expect(spend.unit_economics.cost_per_title_classified).toBe(0.000516);
  });

  // Not 3. The 12m window is 365 days, which is 11.99 average months, and a
  // divisor that is almost right is worse than an awkward one.
  it("keeps the window's fractional length rather than a whole number of months", () => {
    expect(parseSpend(payload()).months_in_range).toBe(2.956879);
  });

  // BigDecimal serialises as a STRING through Rails' encoder, and the query
  // converts to a JSON number deliberately at the last step. A string arriving
  // here means that conversion was dropped, and every sum downstream would
  // silently become string concatenation.
  it("refuses money that arrived as a string", () => {
    const totals = { ...payload().totals, total: "17.88923" };

    expect(() => parseSpend(payload({ totals }))).toThrow(SpendShapeError);
  });

  it("names the field that disagreed, so the fix is not a hunt", () => {
    const totals: Record<string, unknown> = { ...payload().totals };
    delete totals.claude_cost;

    try {
      parseSpend(payload({ totals }));
      expect.unreachable("expected a shape error");
    } catch (error) {
      expect(isSpendShapeError(error)).toBe(true);
      expect((error as SpendShapeError).issues.join(" ")).toContain("totals.claude_cost");
    }
  });

  // "N of M settled" is the legend's whole sentence. If the three counts stopped
  // partitioning the texts sent, that sentence would still render, with numbers
  // that do not add up and nothing on screen to say so.
  it("refuses a bucket whose settled, estimated and unpriceable no longer add up", () => {
    const totals = { ...payload().totals, texts_settled: 1895 };

    expect(() => parseSpend(payload({ totals }))).toThrow(SpendShapeError);
  });

  // Every chart on the page draws these left to right in array order, so a
  // shuffled series renders a plausible chart of the wrong months.
  it("refuses months that are not in calendar order", () => {
    const months = [...payload().months].reverse();

    expect(() => parseSpend(payload({ months }))).toThrow(SpendShapeError);
  });

  it("refuses a window it has no picker for", () => {
    expect(() => parseSpend(payload({ range: "6m" }))).toThrow(SpendShapeError);
  });

  // Rails adding a key is not a reason to blank a page about money.
  it("ignores keys it does not know about", () => {
    expect(parseSpend(payload({ future_figure: 1 }))).not.toHaveProperty("future_figure");
  });

  // Null and zero are opposite answers to a pricing question, and the page says
  // so in words. A schema that coerced either way would erase the difference
  // before the page ever saw it.
  it("keeps every 'nothing to measure' as null rather than zero", () => {
    const spend = parseSpend(emptySpendPayload());

    expect(spend.fixed_monthly_cost_usd).toBeNull();
    expect(spend.unit_economics.cost_per_house_per_month.median).toBeNull();
    expect(spend.unit_economics.cost_per_active_member_per_month.p90).toBeNull();
    expect(spend.unit_economics.cost_per_text_sent).toBeNull();
    expect(spend.unit_economics.cost_per_title_classified).toBeNull();
    expect(spend.houses).toEqual([]);
  });

  it("keeps a house with nobody left to text, with a null per-member figure", () => {
    const house = parseSpend(payload()).houses.find((row) => row.slug === "cobblers-yard");

    expect(house?.active_members).toBe(0);
    expect(house?.total_per_active_member).toBeNull();
  });

  it("keeps a charge in another currency beside the USD total rather than inside it", () => {
    const spend = parseSpend(payload());

    expect(spend.totals.sms_cost_other_currencies).toEqual([{ unit: "GBP", amount: 0.324 }]);
    // The USD total is settled + estimated and nothing else: the GBP charge is
    // reported, never converted, never added.
    //
    // `toBeCloseTo` and not `toBe`, and the reason is the reason Rails publishes
    // `sms_cost` at all: adding these two in IEEE floats gives
    // 15.752600000000001. The page must therefore never compute this sum itself —
    // it renders the figure Rails already added in BigDecimal.
    expect(spend.totals.sms_cost).toBeCloseTo(
      spend.totals.sms_cost_settled + spend.totals.sms_cost_estimated,
      6,
    );
  });
});

describe("the overview tile's shape", () => {
  // It is defined beside the spend payload so there is one definition of what
  // the tile renders, whether the figures are derived here or inlined by Rails
  // one day. See the `spend` key in ./super-admin-overview.ts.
  it("accepts a derived tile, with or without a month to compare against", () => {
    const tile = {
      range: "90d",
      currency: "USD",
      this_month: { month: "2026-09", sms_cost: 2.9273, claude_cost: 0.36963, total: 3.29693 },
      last_month: { month: "2026-08", sms_cost: 5.5415, claude_cost: 0.784, total: 6.3255 },
    };

    expect(overviewSpendSchema.parse(tile).this_month.total).toBe(3.29693);
    expect(overviewSpendSchema.parse({ ...tile, last_month: null }).last_month).toBeNull();
  });

  it("refuses a tile whose figures went missing", () => {
    const tile = {
      range: "90d",
      currency: "USD",
      this_month: { month: "2026-09", sms_cost: 2.9273, claude_cost: 0.36963 },
      last_month: null,
    };

    expect(overviewSpendSchema.safeParse(tile).success).toBe(false);
  });
});

describe("the schema is exported for anything that needs it raw", () => {
  it("parses through the same object parseSpend uses", () => {
    expect(spendSchema.safeParse(payload()).success).toBe(true);
  });
});
