import { describe, expect, it } from "vitest";

import { parseSpend } from "@/lib/api/super-admin-spend";
import { formatCount } from "@/lib/charts";
import {
  emptySpendPayload,
  spendPayload,
  unconvertedSpendPayload,
} from "@/test/spend-payload";

import {
  SPEND_RANGE_LABELS,
  activeMembersNote,
  allocatedFixedCostTotal,
  claudeShortfallNote,
  fixedCostPerHousePerMonth,
  formatAmount,
  formatOtherCurrency,
  claudeUnconvertedNote,
  drawableSeries,
  conversionNote,
  currencySymbol,
  formatMoney,
  houseMonthlyCosts,
  houseSpend,
  lossMakingCount,
  lossMakingNote,
  marginAt,
  marginInputs,
  marginSummary,
  monthLabel,
  monthsCoveredNote,
  overviewSpend,
  parseCandidatePrice,
  parseSpendRange,
  perActiveMemberNote,
  pricingNote,
  seriesSplitNote,
  seriesValues,
  settledShare,
  spendRangeHref,
  unitFigure,
} from "./hq-spend";

const spend = parseSpend(spendPayload());
const empty = parseSpend(emptySpendPayload());

describe("the range picker", () => {
  it("takes the window from the URL and refuses to forward one Rails would reject", () => {
    expect(parseSpendRange("12m")).toBe("12m");
    // Rails answers 400 for a window it does not know. A stale bookmark deserves
    // figures, not an error page.
    expect(parseSpendRange("6m")).toBe("30d");
    expect(parseSpendRange(undefined)).toBe("30d");
  });

  // Next hands back an array when a parameter is repeated, which is a thing a
  // link cannot produce and a person can.
  it("takes the first value when the parameter is repeated", () => {
    expect(parseSpendRange(["90d", "12m"])).toBe("90d");
    expect(parseSpendRange(["nonsense", "90d"])).toBe("30d");
  });

  it("spells every href one way", () => {
    expect(spendRangeHref("90d")).toBe("/super-admin/spend?range=90d");
    expect(Object.keys(SPEND_RANGE_LABELS)).toEqual(["30d", "90d", "12m"]);
  });
});

// The project's number rule, and the reason this module exists. Rails computes
// money at six decimals because one SMS segment costs under a hundredth of a
// cent; rendering that as "£0.01" overstates the product's variable cost on the
// one figure a price is set against.
describe("money renders at the precision the API sent", () => {
  it("keeps every decimal a sub-cent figure carries", () => {
    expect(formatMoney(0.0079, "GBP")).toBe("£0.0079");
    expect(formatMoney(0.000516, "GBP")).toBe("£0.000516");
    expect(formatMoney(17.88923, "GBP")).toBe("£17.88923");
  });

  it("never renders fewer than two decimals, so a round figure still reads as money", () => {
    expect(formatMoney(2.5, "GBP")).toBe("£2.50");
    expect(formatMoney(42, "GBP")).toBe("£42.00");
    expect(formatMoney(0, "GBP")).toBe("£0.00");
  });

  it("groups the thousands by hand, never through Intl", () => {
    expect(formatMoney(12418.5, "GBP")).toBe("£12,418.50");
    expect(formatCount(690_080)).toBe("690,080");
    expect(formatCount(1)).toBe("1");
  });

  it("carries a negative, which is what a margin below cost looks like", () => {
    expect(formatMoney(-3.2, "GBP")).toBe("-£3.20");
    expect(formatAmount(-0.0079)).toBe("-0.0079");
  });

  // A value that rounds away to nothing should not keep a minus sign it no
  // longer earns: "-£0.00" reads as a loss that is not there.
  it("drops the sign from a value that rounds to nothing", () => {
    expect(formatMoney(-0.0000001, "GBP")).toBe("£0.00");
  });

  it("names a currency it cannot convert rather than inventing a symbol", () => {
    expect(formatOtherCurrency(0.324, "USD")).toBe("0.324 USD");
  });
});

// Rule 4: nothing on this page hardcodes a sign. The symbol is looked up from
// the payload's own `currency`, so the day Rails reports something else the
// figures follow it instead of quietly growing the wrong one.
describe("the currency comes from the payload, never from the page", () => {
  it("takes the symbol from the code Rails sent", () => {
    expect(currencySymbol("GBP")).toBe("£");
    // en-GB disambiguates the dollar, which is what a page of pounds wants: a
    // lone "$" next to "£" invites a reader to take both as the same money.
    expect(currencySymbol("USD")).toBe("US$");
    expect(formatMoney(1.5, "USD")).toBe("US$1.50");
  });

  // Intl resolves the symbol and NOTHING else: a currency-styled formatter caps
  // at two fraction digits, which would round £0.0079 to £0.04 and break rule 1
  // outright, and its separators resolve differently under Node's ICU and a
  // browser's. The digits stay hand-grouped.
  it("still prints six decimals and hand-grouped thousands under a real currency", () => {
    expect(formatMoney(12418.000516, "GBP")).toBe("£12,418.000516");
  });

  // A code with no symbol of its own trails instead of printing "XTS3.20",
  // which reads as a typo rather than as money.
  it("trails a code it has no symbol for rather than jamming it in front", () => {
    expect(formatMoney(3.2, "XTS")).toBe("3.20 XTS");
  });
});

describe("months", () => {
  it("renders a calendar month without ever building a Date from it", () => {
    expect(monthLabel("2026-09")).toBe("Sept 2026");
    expect(monthLabel("2026-01")).toBe("Jan 2026");
  });

  it("throws on something that is not a month, rather than printing NaN", () => {
    expect(() => monthLabel("2026-13")).toThrow(RangeError);
    expect(() => monthLabel("September")).toThrow(RangeError);
  });

  it("names the months one figure covers", () => {
    expect(monthsCoveredNote(["2026-06", "2026-07", "2026-08", "2026-09"])).toBe(
      "Sept 2026, and the 3 months before it",
    );
    expect(monthsCoveredNote(["2026-08", "2026-09"])).toBe("Sept 2026, and the month before it");
    expect(monthsCoveredNote(["2026-09"])).toBe("Sept 2026");
  });
});

describe("what the SMS figure can and cannot say", () => {
  it("publishes the settled share at one decimal, with its denominator in words", () => {
    expect(settledShare(spend.totals)).toBe(95.4);
    expect(
      pricingNote(spend.totals, spend.sms_estimated_segment_cost_gbp, spend.currency),
    ).toBe(
      "1,896 of 1,988 texts carry the price Twilio charged (95.4%). " +
        "74 are still estimated at £0.0079 a segment while Twilio settles. " +
        "18 texts are past Twilio's retention and will stay an estimate for good.",
    );
  });

  // "A list price we typed in" and "the mean of what Twilio actually charged
  // us" are different claims, and the second is much the stronger one. The
  // sentence has to say which, or an operator cannot tell how much to trust the
  // estimate they are pricing against.
  it("says how many settled texts a measured rate came from", () => {
    expect(
      pricingNote(spend.totals, spend.sms_estimated_segment_cost_gbp, spend.currency, 92),
    ).toContain("estimated at £0.0079 a segment, the mean of 92 settled texts, while Twilio settles");
  });

  it("says nothing about estimates when there are none", () => {
    const house = spend.houses.find((row) => row.slug === "cobblers-yard")!;

    expect(pricingNote(house, spend.sms_estimated_segment_cost_gbp, spend.currency)).toBe(
      "96 of 96 texts carry the price Twilio charged (100.0%).",
    );
  });

  it("has no rate at all when nothing was sent, rather than 0%", () => {
    expect(settledShare(empty.totals)).toBeNull();
    expect(pricingNote(empty.totals, 0.0079, "GBP")).toBe(
      "No texts were sent in this window, so nothing is priced.",
    );
  });

  it("says what the Claude figure is short by, and stays quiet when it is not", () => {
    expect(claudeShortfallNote(spend.totals)).toBe(
      "3 Claude calls had no rate in the table, so this figure is short by whatever they cost.",
    );
    expect(claudeShortfallNote(empty.totals)).toBeNull();
  });
});

// Null and zero are opposite answers to a pricing question. Every one of these
// says so in words, and none of them renders "$0.00".
describe("every number in the chart is also in text", () => {
  // The stacked bar carries three values in three fills, and two of those chart
  // cuts are hard to separate for a protanopic reader (see SPEND_SERIES). The
  // printed split is what makes the row complete without colour at all, so it
  // has to carry the same three figures the bar does, in the same order.
  it("prints a bucket's three figures in series order, at full precision", () => {
    expect(seriesSplitNote(spend.months[2], spend.currency)).toBe(
      "£5.4704 settled · £0.0711 estimated · £0.784 Claude",
    );
  });

  it("still prints all three when a month cost nothing", () => {
    expect(seriesSplitNote(empty.totals, empty.currency)).toBe(
      "£0.00 settled · £0.00 estimated · £0.00 Claude",
    );
  });

  // An unconverted Claude cost is DROPPED from the line rather than printed as
  // "£0.00 Claude", which would be the page asserting Claude was free. The bar
  // loses its segment for the same reason; `claudeUnconvertedNote` is what says
  // where the figure went.
  it("drops Claude from the line when there is no figure for it in this currency", () => {
    const unconverted = parseSpend(unconvertedSpendPayload());

    expect(seriesSplitNote(unconverted.months[2], unconverted.currency)).toBe(
      "£5.4704 settled · £0.0711 estimated",
    );
    expect(seriesValues(unconverted.months[2])).toEqual([5.4704, 0.0711, 0]);
  });

  // The group card draws each series as its OWN bar with its own printed total,
  // so a Claude row at "£0.00" there would be the page asserting Claude was
  // free — the one thing this surface must never say. It is dropped instead.
  // The month bars keep the zero because a zero-length segment inside a bar
  // draws nothing and claims nothing; `seriesValues` above is that path.
  it("drops a series with no figure in this currency rather than drawing it at zero", () => {
    const unconverted = parseSpend(unconvertedSpendPayload());
    const house = unconverted.houses[0];

    expect(drawableSeries(spend.houses[0]).map((series) => series.key)).toEqual([
      "sms_cost_settled",
      "sms_cost_estimated",
      "claude_cost",
    ]);
    expect(drawableSeries(house).map((series) => series.key)).toEqual([
      "sms_cost_settled",
      "sms_cost_estimated",
    ]);
    expect(drawableSeries(house).every((series) => typeof series.value === "number")).toBe(true);
  });
});

// The totals render perfectly while being short, which is the one failure a
// reader cannot see. So it is said in words, with the figure that is missing.
describe("what the page says when Claude could not be converted", () => {
  it("names what is missing, what it cost and how to fold it in", () => {
    const unconverted = parseSpend(unconvertedSpendPayload());
    const note = claudeUnconvertedNote(unconverted)!;

    expect(note).toContain("no conversion rate is configured");
    expect(note).toContain("2.670788 USD");
    expect(note).toContain("SPEND_GBP_PER_USD");
  });

  it("stays quiet when there is a rate, and prints it instead", () => {
    expect(claudeUnconvertedNote(spend)).toBeNull();
    expect(conversionNote(spend.gbp_per_usd, spend.currency)).toBe(
      "Claude is billed in USD and converted at 0.80 GBP to the dollar.",
    );
  });

  it("has no conversion sentence when there is no rate to print", () => {
    expect(conversionNote(null, "GBP")).toBeNull();
  });
});

describe("nothing to measure is never a zero", () => {
  it("says why there is no per-member figure, without an em dash", () => {
    const nobody = spend.houses.find((row) => row.slug === "cobblers-yard")!;
    const somebody = spend.houses.find((row) => row.slug === "alma-road")!;

    expect(perActiveMemberNote(nobody, spend.currency)).toBe("no active members");
    expect(perActiveMemberNote(nobody, spend.currency)).not.toContain("—");
    expect(perActiveMemberNote(somebody, spend.currency)).toBe("£1.234681");
    expect(activeMembersNote(nobody)).toBe("nobody on the roll");
    expect(activeMembersNote(somebody)).toBe("9 housemates");
  });

  it("says 'not enough data' for a unit figure Rails could not compute", () => {
    expect(unitFigure(null, "GBP")).toBe("not enough data");
    expect(unitFigure(0.007924, "GBP")).toBe("£0.007924");
  });
});

describe("the overview tile", () => {
  // months[-1] is this month SO FAR — the window ends now — and months[-2] is
  // the last whole one. Getting these the wrong way round would put a part month
  // in the "last month" slot and read as a collapse in spend.
  it("reads this month from the last bucket and last month from the one before", () => {
    const tile = overviewSpend(spend)!;

    expect(tile.this_month).toEqual({
      month: "2026-09",
      sms_cost: 2.9273,
      claude_cost: 0.36963,
      total: 3.29693,
    });
    expect(tile.last_month?.month).toBe("2026-08");
    expect(tile.last_month?.total).toBe(6.3255);
    expect(tile.range).toBe("90d");
    expect(tile.currency).toBe("GBP");
    expect(tile.claude_unconverted).toBe(false);
  });

  // The tile has to carry the flag, not just the figures: its own "Claude" cell
  // is null, and without the flag it has nothing to explain the null with.
  it("carries the unconverted flag and a null Claude cost through to the tile", () => {
    const tile = overviewSpend(parseSpend(unconvertedSpendPayload()))!;

    expect(tile.claude_unconverted).toBe(true);
    expect(tile.this_month.claude_cost).toBeNull();
  });

  it("has no month to compare against when the window holds only one", () => {
    const single = parseSpend(spendPayload({ months: [spendPayload().months[3]] }));

    expect(overviewSpend(single)?.last_month).toBeNull();
  });
});

describe("one house, filtered out of the whole-product payload", () => {
  // There is no per-group spend endpoint: the group card reads the same cached
  // payload the spend page draws, so the two can never disagree.
  it("finds the house and carries the window it was measured in", () => {
    const card = houseSpend(spend, 8);

    expect(card.house?.name).toBe("Bell Street");
    expect(card.months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(card.monthsInRange).toBe(2.956879);
    expect(card.estimatedSegmentCost).toBe(0.0079);
    expect(card.estimatedSegmentCostFromSettled).toBeNull();
    expect(card.claudeUnconverted).toBe(false);
    expect(card.range).toBe("90d");
  });

  // Rails only emits a row for a house that spent something, so absent means
  // "cost nothing" — a real answer the card can give.
  it("reports a house that spent nothing as absent, with the window still named", () => {
    const card = houseSpend(spend, 9999);

    expect(card.house).toBeNull();
    expect(card.months).toHaveLength(4);
  });
});

describe("the margin calculator", () => {
  const inputs = marginInputs(spend);

  // The monthly divisor is the window's TRUE length (2.956879 months for 90
  // days), not the number of bars on the chart.
  it("derives each house's monthly cost from the window's real length", () => {
    const costs = houseMonthlyCosts(spend);

    expect(costs).toHaveLength(4);
    expect(costs[0]).toBeCloseTo(11.11213 / 2.956879, 6);
  });

  // The percentiles the calculator quotes are Rails' own, so the calculator and
  // the tiles above it can never show two different medians. This is the check
  // that they really are the nearest-rank values of the rows on the page:
  // with four houses the median is rank 2 and p90 is rank 4, both real houses.
  it("quotes percentiles that are houses actually on the page", () => {
    const sorted = [...houseMonthlyCosts(spend)].sort((a, b) => a - b);

    expect(inputs.medianCost).toBeCloseTo(sorted[1], 5);
    expect(inputs.p90Cost).toBeCloseTo(sorted[3], 5);
  });

  // Rails allocates the SAME fixed share to every house, so folding it in shifts
  // every cost by one figure and cannot change which house sits at a percentile.
  // That is what lets the summary add it to the percentile directly.
  it("derives the monthly fixed share the same way Rails allocated it", () => {
    const share = fixedCostPerHousePerMonth(spend)!;
    const perHouse = spend.houses[0].allocated_fixed_cost!;

    expect(share).toBe(10.5);
    expect(share).toBeCloseTo(perHouse / spend.months_in_range, 4);
    expect(fixedCostPerHousePerMonth(empty)).toBeNull();
  });

  // A totals row exists so a reader can check that the column above it adds up.
  // Summed from the rows, not recomputed as `fixed_monthly × months`, because a
  // figure derived a second way cannot do that job.
  it("totals the allocated fixed cost column from the shares in it", () => {
    expect(allocatedFixedCostTotal(spend)).toBe(124.18892);
    expect(allocatedFixedCostTotal(spend)).toBeCloseTo(
      spend.houses.reduce((sum, house) => sum + (house.allocated_fixed_cost ?? 0), 0),
      6,
    );
    expect(allocatedFixedCostTotal(empty)).toBeNull();
  });

  it("measures margin as a share of the price, not of the cost", () => {
    expect(marginAt(5, 1.25)).toEqual({ cost: 1.25, margin: 3.75, rate: 75 });
    expect(marginAt(4, 4.4)).toEqual({ cost: 4.4, margin: -0.4, rate: -10 });
  });

  it("has no margin rate at a price of zero rather than an infinity", () => {
    expect(marginAt(0, 1.25).rate).toBeNull();
    expect(marginAt(0, 1.25).margin).toBe(-1.25);
  });

  // Break-even is not loss-making. A house that costs exactly the price is
  // covered, and counting it as a loss would make every round price look worse
  // than it is.
  it("counts a house as loss-making only when it costs MORE than the price", () => {
    expect(lossMakingCount(2, [1, 2, 3])).toBe(1);
    expect(lossMakingCount(3, [1, 2, 3])).toBe(0);
    expect(lossMakingCount(0, [])).toBe(0);
  });

  it("answers a candidate price with both percentiles and the count it would not cover", () => {
    const summary = marginSummary(inputs, 5);

    expect(summary.median?.cost).toBeCloseTo(0.288345, 6);
    expect(summary.median?.margin).toBeCloseTo(4.711655, 6);
    expect(summary.p90?.margin).toBeCloseTo(5 - 3.758061, 6);
    // Every house here costs well under $5 a month in texts and Claude.
    expect(summary.lossMaking).toBe(0);
    expect(summary.housesMeasured).toBe(4);
  });

  // The point of the option: variable cost is what one more house costs, and
  // variable plus allocated is what one house has to EARN. A subscription has to
  // cover the second, and at $5 with $10.50 of hosting to carry, it does not.
  it("changes the answer when the fixed cost is folded in", () => {
    const variable = marginSummary(inputs, 5);
    const loaded = marginSummary(inputs, 5, { withFixedCost: true });

    expect(loaded.median!.cost).toBeCloseTo(variable.median!.cost + 10.5, 6);
    expect(loaded.median!.margin).toBeLessThan(0);
    expect(loaded.lossMaking).toBe(4);
    expect(lossMakingNote(loaded)).toBe("4 of 4 houses would lose money at this price.");
  });

  it("says 'every one of them' in words rather than showing a zero", () => {
    expect(lossMakingNote(marginSummary(inputs, 5))).toBe(
      "This price covers every one of the 4 houses measured.",
    );
  });

  it("has nothing to say when no house has spent anything", () => {
    const summary = marginSummary(marginInputs(empty), 5);

    expect(summary.median).toBeNull();
    expect(summary.p90).toBeNull();
    expect(lossMakingNote(summary)).toBe("No house has spent anything in this window yet.");
  });

  // An operator halfway through typing "4." must not blank the panel or, worse,
  // see a margin computed against NaN.
  it("reads a typed price forgivingly and refuses nonsense outright", () => {
    expect(parseCandidatePrice("5")).toBe(5);
    expect(parseCandidatePrice(" 4.50 ")).toBe(4.5);
    expect(parseCandidatePrice("")).toBeNull();
    expect(parseCandidatePrice("4.")).toBe(4);
    expect(parseCandidatePrice("five")).toBeNull();
    expect(parseCandidatePrice("-3")).toBeNull();
  });
});
