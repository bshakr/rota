/**
 * One well-formed `GET /api/super_admin/spend?range=90d` body, shared by the
 * schema's own tests, by the client's, by the words in hq-spend.test.ts and by
 * the screenshot routes.
 *
 * Shared rather than copied so there is exactly ONE idea of what Rails renders
 * in the web tests. Two hand-maintained copies drift, and the copy that drifts
 * is always the one in the test that would otherwise have caught the drift.
 *
 * Written as plain JSON (`unknown` in, not the parsed type) on purpose: these
 * tests exercise the PARSE, so the fixture must be able to hold a wrong shape.
 *
 * The figures are ARITHMETICALLY CONSISTENT, and that is not decoration:
 *
 *   - the four months sum to `totals`, field by field;
 *   - the four houses sum to `totals` too;
 *   - `texts_settled + texts_estimated + texts_unpriceable == texts_sent` in
 *     every bucket (the schema asserts this);
 *   - `sms_cost == sms_cost_settled + sms_cost_estimated` and
 *     `total == sms_cost + claude_cost`;
 *   - `claude_cost == claude_usd × gbp_per_usd` at six decimals, both ways;
 *   - every estimate is `estimated segments × 0.0079`, the fixture's own
 *     `sms_estimated_segment_cost_gbp`;
 *   - the unit economics are the nearest-rank percentiles of the house rows
 *     divided by `months_in_range` — 2.956879, the real length of 90 days in
 *     average calendar months, not 3.
 *
 * A fixture whose totals did not add up would let a rendering bug through and,
 * worse, would teach whoever read it that the API's own figures do not add up.
 *
 * The cast of four is chosen to cover the cases the page has special words for:
 * Alma Road has texts that will never be priced, Bell Street has a charge in
 * a currency the API would not convert, Cobbler's Yard has nobody left to text (so its per-member
 * figure is null), and Dray Lane has nothing settled at all.
 */
function base() {
  return {
    range: "90d",
    currency: "GBP",
    // Anthropic's dollars at this rate are the fixture's pound Claude figures.
    // Both are carried at the payload's six decimals, which is where the
    // equality `claude_cost == claude_usd × gbp_per_usd` holds — the real API
    // rounds both the same way, so the fixture does too.
    gbp_per_usd: 0.8,
    claude_unconverted: false,
    starts_at: "2026-06-16T09:12:04.000Z",
    ends_at: "2026-09-14T09:12:04.000Z",
    // 90 days as average calendar months. NOT 3 — see the schema's note.
    months_in_range: 2.956879,
    fixed_monthly_cost_gbp: 42.0 as number | null,
    // The fixture's OWN rate, deliberately not the query object's default: these
    // tests pin how a rate is rendered and multiplied, not what it happens to be.
    sms_estimated_segment_cost_gbp: 0.0079,
    // Null: the configured rate rather than one measured from settled texts.
    // `withMeasuredRate()` below is the other case.
    sms_estimated_segment_cost_from_settled: null as number | null,
    houses_with_spend: 4,
    houses_total: 6,

    totals: {
      texts_sent: 1988,
      segments: 2083,
      texts_settled: 1896,
      sms_cost_settled: 14.9784,
      texts_estimated: 74,
      texts_unpriceable: 18,
      sms_cost_estimated: 0.7742,
      sms_cost: 15.7526,
      sms_cost_other_currencies: [{ unit: "USD", amount: 0.324 }],
      claude_calls: 518,
      claude_tokens_in: 690_080,
      claude_tokens_out: 38_710,
      claude_usd: 2.670788,

      claude_cost: 2.13663,
      claude_calls_unpriced: 3,
      titles_classified: 4144,
      total: 17.88923,
    },

    months: [
      {
        month: "2026-06",
        starts_on: "2026-06-01",
        texts_sent: 300,
        segments: 316,
        texts_settled: 300,
        sms_cost_settled: 2.37,
        texts_estimated: 0,
        texts_unpriceable: 0,
        sms_cost_estimated: 0,
        sms_cost: 2.37,
        sms_cost_other_currencies: [],
        claude_calls: 78,
        claude_tokens_in: 104_000,
        claude_tokens_out: 5_800,
        claude_usd: 0.4025,

        claude_cost: 0.322,
        claude_calls_unpriced: 0,
        titles_classified: 624,
        total: 2.692,
      },
      {
        month: "2026-07",
        starts_on: "2026-07-01",
        texts_sent: 620,
        segments: 650,
        texts_settled: 610,
        sms_cost_settled: 4.819,
        texts_estimated: 0,
        texts_unpriceable: 10,
        sms_cost_estimated: 0.0948,
        sms_cost: 4.9138,
        sms_cost_other_currencies: [],
        claude_calls: 160,
        claude_tokens_in: 214_000,
        claude_tokens_out: 12_100,
        claude_usd: 0.82625,

        claude_cost: 0.661,
        claude_calls_unpriced: 0,
        titles_classified: 1280,
        total: 5.5748,
      },
      {
        month: "2026-08",
        starts_on: "2026-08-01",
        texts_sent: 700,
        segments: 735,
        texts_settled: 692,
        sms_cost_settled: 5.4704,
        texts_estimated: 0,
        texts_unpriceable: 8,
        sms_cost_estimated: 0.0711,
        sms_cost: 5.5415,
        sms_cost_other_currencies: [{ unit: "GBP", amount: 0.324 }],
        claude_calls: 190,
        claude_tokens_in: 254_000,
        claude_tokens_out: 14_200,
        claude_usd: 0.98,

        claude_cost: 0.784,
        claude_calls_unpriced: 0,
        titles_classified: 1520,
        total: 6.3255,
      },
      {
        // This month so far — the entry the overview tile reads as `months[-1]`.
        month: "2026-09",
        starts_on: "2026-09-01",
        texts_sent: 368,
        segments: 382,
        texts_settled: 294,
        sms_cost_settled: 2.319,
        texts_estimated: 74,
        texts_unpriceable: 0,
        sms_cost_estimated: 0.6083,
        sms_cost: 2.9273,
        sms_cost_other_currencies: [],
        claude_calls: 90,
        claude_tokens_in: 118_080,
        claude_tokens_out: 6_610,
        claude_usd: 0.462038,

        claude_cost: 0.36963,
        claude_calls_unpriced: 3,
        titles_classified: 720,
        total: 3.29693,
      },
    ],

    houses: [
      {
        group_id: 12,
        name: "Alma Road",
        slug: "alma-road",
        texts_sent: 1240,
        segments: 1302,
        texts_settled: 1180,
        sms_cost_settled: 9.322,
        texts_estimated: 42,
        // The house with rows past Twilio's retention: estimated for good.
        texts_unpriceable: 18,
        sms_cost_estimated: 0.5056,
        sms_cost: 9.8276,
        sms_cost_other_currencies: [],
        claude_calls: 310,
        claude_tokens_in: 412_880,
        claude_tokens_out: 24_110,
        claude_usd: 1.605663,

        claude_cost: 1.28453,
        claude_calls_unpriced: 0,
        titles_classified: 2480,
        total: 11.11213,
        active_members: 9,
        total_per_active_member: 1.234681,
        allocated_fixed_cost: 31.04723,
      },
      {
        group_id: 8,
        name: "Bell Street",
        slug: "bell-street",
        texts_sent: 640,
        segments: 668,
        texts_settled: 620,
        sms_cost_settled: 4.898,
        texts_estimated: 20,
        texts_unpriceable: 0,
        sms_cost_estimated: 0.1738,
        sms_cost: 5.0718,
        // The house with a charge Rails refused to convert.
        sms_cost_other_currencies: [{ unit: "GBP", amount: 0.324 }],
        claude_calls: 180,
        claude_tokens_in: 241_000,
        claude_tokens_out: 12_400,
        claude_usd: 0.927625,

        claude_cost: 0.7421,
        claude_calls_unpriced: 3,
        titles_classified: 1440,
        total: 5.8139,
        active_members: 6,
        total_per_active_member: 0.968983,
        allocated_fixed_cost: 31.04723,
      },
      {
        group_id: 21,
        name: "Cobbler's Yard",
        slug: "cobblers-yard",
        texts_sent: 96,
        segments: 101,
        texts_settled: 96,
        sms_cost_settled: 0.7584,
        texts_estimated: 0,
        texts_unpriceable: 0,
        sms_cost_estimated: 0,
        sms_cost: 0.7584,
        sms_cost_other_currencies: [],
        claude_calls: 24,
        claude_tokens_in: 31_000,
        claude_tokens_out: 1_900,
        claude_usd: 0.11775,

        claude_cost: 0.0942,
        claude_calls_unpriced: 0,
        titles_classified: 192,
        total: 0.8526,
        // Nobody left to text: the per-member figure has no answer at all.
        active_members: 0,
        total_per_active_member: null,
        allocated_fixed_cost: 31.04723,
      },
      {
        group_id: 5,
        name: "Dray Lane",
        slug: "dray-lane",
        texts_sent: 12,
        segments: 12,
        // Nothing settled yet: every figure on this row's SMS half is an estimate.
        texts_settled: 0,
        sms_cost_settled: 0,
        texts_estimated: 12,
        texts_unpriceable: 0,
        sms_cost_estimated: 0.0948,
        sms_cost: 0.0948,
        sms_cost_other_currencies: [],
        claude_calls: 4,
        claude_tokens_in: 5_200,
        claude_tokens_out: 300,
        claude_usd: 0.01975,

        claude_cost: 0.0158,
        claude_calls_unpriced: 0,
        titles_classified: 32,
        total: 0.1106,
        active_members: 3,
        total_per_active_member: 0.036867,
        allocated_fixed_cost: 31.04723,
      },
    ],

    unit_economics: {
      // Nearest rank across the four houses: the median is Cobbler's Yard and
      // p90 is Alma Road, both of them houses that actually exist.
      cost_per_house_per_month: {
        median: 0.288345 as number | null,
        p90: 3.758061 as number | null,
      },
      // Three houses only — Cobbler's Yard has nobody to divide by and is not in
      // this spread at all.
      cost_per_active_member_per_month: {
        median: 0.327705 as number | null,
        p90: 0.417562 as number | null,
      },
      cost_per_text_sent: 0.007924 as number | null,
      cost_per_title_classified: 0.000516 as number | null,
      houses_measured: 4,
      houses_with_active_members: 3,
    },
  };
}

/** The fixture's shape, so a test can destructure it without casting. */
export type SpendFixture = ReturnType<typeof base>;

/**
 * The payload, with any key replaced. The cast is deliberate: a test's whole job
 * here is to hand `parseSpend` a WRONG shape and watch it refuse, so the
 * overrides are unknown going in while the result stays destructurable.
 */
export function spendPayload(overrides: Record<string, unknown> = {}): SpendFixture {
  return { ...base(), ...overrides } as SpendFixture;
}

/**
 * A product on which nothing has been spent yet: houses exist, none of them has
 * sent a text or classified a title.
 *
 * Its own function rather than a pile of overrides, because "empty" is a state
 * the page has to render as carefully as the full one — every percentile null,
 * every per-unit price null, no house rows at all, and no fixed cost configured
 * — and a test that assembles that by hand each time will eventually assemble a
 * slightly different one.
 */
export function emptySpendPayload(overrides: Record<string, unknown> = {}): SpendFixture {
  const zeroFigures = {
    texts_sent: 0,
    segments: 0,
    texts_settled: 0,
    sms_cost_settled: 0,
    texts_estimated: 0,
    texts_unpriceable: 0,
    sms_cost_estimated: 0,
    sms_cost: 0,
    sms_cost_other_currencies: [],
    claude_calls: 0,
    claude_tokens_in: 0,
    claude_tokens_out: 0,
    claude_usd: 0,
    claude_cost: 0,
    claude_calls_unpriced: 0,
    titles_classified: 0,
    total: 0,
  };

  return {
    ...base(),
    fixed_monthly_cost_gbp: null,
    houses_with_spend: 0,
    houses_total: 3,
    totals: { ...zeroFigures },
    months: base().months.map((month) => ({
      month: month.month,
      starts_on: month.starts_on,
      ...zeroFigures,
    })),
    houses: [],
    unit_economics: {
      cost_per_house_per_month: { median: null, p90: null },
      cost_per_active_member_per_month: { median: null, p90: null },
      cost_per_text_sent: null,
      cost_per_title_classified: null,
      houses_measured: 0,
      houses_with_active_members: 0,
    },
    ...overrides,
  } as SpendFixture;
}

/**
 * The same payload with NO conversion rate configured — the state production is
 * in until somebody sets `SPEND_GBP_PER_USD`.
 *
 * Claude keeps its dollar figure and loses its pound one (null, never zero), and
 * every `total` drops back to the SMS half, because Rails leaves an unconvertible
 * figure OUT of a total rather than folding in the wrong currency. Derived from
 * `base()` rather than hand-written so the two cannot drift: the only difference
 * between them is the rate, which is the point of the fixture.
 */
export function unconvertedSpendPayload(overrides: Record<string, unknown> = {}): SpendFixture {
  const strip = <T extends { claude_cost: number; sms_cost: number }>(figures: T) => ({
    ...figures,
    claude_cost: null as number | null,
    // Rails re-adds the total in BigDecimal; `sms_cost` is the figure it already
    // added, so reading it back is exact where `total - claude_cost` would not be.
    total: figures.sms_cost,
  });

  const payload = base();
  return {
    ...payload,
    gbp_per_usd: null as number | null,
    claude_unconverted: true,
    totals: strip(payload.totals),
    months: payload.months.map(strip),
    houses: payload.houses.map((house) => ({
      ...strip(house),
      // Per-member follows the total it divides: SMS only, at six decimals.
      total_per_active_member:
        house.active_members === 0
          ? null
          : Math.round((house.sms_cost / house.active_members) * 1e6) / 1e6,
    })),
    unit_economics: {
      ...payload.unit_economics,
      // No pound cost per title without a rate. Null, like every other figure
      // here that has no answer.
      cost_per_title_classified: null as number | null,
    },
    ...overrides,
  } as SpendFixture;
}
