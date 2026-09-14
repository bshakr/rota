import { describe, expect, it } from "vitest";

import { MIN_STACK_SHARE, barPercents, formatCount, sparklineGeometry, stackShares } from "./charts";

/** Every number in a `d` attribute, so a NaN cannot hide inside a path string. */
function numbersIn(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("barPercents", () => {
  it("measures every bar against the longest one", () => {
    expect(barPercents([10, 5, 2])).toEqual([100, 50, 20]);
  });

  it("keeps one decimal rather than rounding a share to a whole percent", () => {
    expect(barPercents([3, 7])).toEqual([42.9, 100]);
  });

  // The case the page hits on day one, and the one that renders as `width: NaN%`
  // if the divisor is not checked: a chart is blank either way, and a blank
  // chart looks exactly like a quiet week.
  it("draws empty bars rather than NaN when every value is zero", () => {
    expect(barPercents([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("has nothing to measure in an empty set", () => {
    expect(barPercents([])).toEqual([]);
  });

  // Null is "not measured" and must never be drawn as zero — the funnel's first
  // step is exactly this, and "nobody visited" and "nobody counted" are opposite
  // facts.
  it("passes a hole through as a hole", () => {
    expect(barPercents([null, 8, 4])).toEqual([null, 100, 50]);
  });

  it("ignores a hole when looking for the longest bar", () => {
    expect(barPercents([null, 0])).toEqual([null, 0]);
  });
});

describe("stackShares", () => {
  it("splits a row into its segments", () => {
    expect(stackShares([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it("keeps one decimal on an uneven split", () => {
    expect(stackShares([1, 2])).toEqual([33.3, 66.7]);
  });

  // A week in which nothing was sent. The row still renders — an x-axis that
  // changes shape between two ranges cannot be compared with itself — but every
  // segment is zero-width, and none of them is NaN.
  it("gives an all-zero week zero-width segments, not NaN", () => {
    const shares = stackShares([0, 0, 0]);
    expect(shares).toEqual([0, 0, 0]);
    expect(shares.every(Number.isFinite)).toBe(true);
  });

  // The finding this floor exists for: one cover notice in a week of four
  // thousand reminders is 0.02%, which rounds to 0.0 — and the caller drops
  // zero-width segments, so the cover that DID happen would draw the same row as
  // a week with no covers in it.
  it("never rounds something that happened down to nothing", () => {
    const shares = stackShares([4000, 1]);

    expect(shares[1]).toBe(MIN_STACK_SHARE);
    expect(shares[1]).toBeGreaterThan(0);
  });

  it("keeps zero for zero, so a caller can still tell the two apart", () => {
    expect(stackShares([4000, 0, 1])).toEqual([100, 0, MIN_STACK_SHARE]);
  });

  // The cost of the floor, stated rather than discovered: a very lopsided row
  // can sum to a tenth or two over 100. The track absorbs it; a vanishing
  // segment would not be absorbed by anything.
  it("may overshoot 100 by a rounding step rather than lose a segment", () => {
    const total = stackShares([4000, 1, 1]).reduce((sum, share) => sum + share, 0);

    expect(total).toBeGreaterThanOrEqual(100);
    expect(total).toBeLessThan(100.5);
  });

  it("has nothing to split in an empty set", () => {
    expect(stackShares([])).toEqual([]);
  });
});

describe("sparklineGeometry", () => {
  const scale = { width: 100, height: 30, pad: 2 };

  it("draws one line through every reading, oldest on the left", () => {
    const { lines, dots } = sparklineGeometry([0, 5, 10], scale);

    expect(dots).toEqual([]);
    expect(lines).toHaveLength(1);
    // Floor 0, ceiling 10, a 26-unit plot inset by 2: bottom, middle, top.
    expect(lines[0]).toBe("M 0,28 L 50,15 L 100,2");
  });

  it("breaks the line at a week it has no reading for", () => {
    const { lines } = sparklineGeometry([1, 2, null, 4, 5], scale);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("M 0,");
    expect(lines[1]).toContain("M 75,");
  });

  // The stranded point keeps its own marker rather than vanishing with its run:
  // a week either side with no reading is the case where a single value is the
  // only thing the chart has to say.
  it("leaves a one-week run as a dot rather than dropping it", () => {
    const { lines, dots } = sparklineGeometry([1, null, 3, 4], scale);

    expect(lines).toHaveLength(1);
    expect(dots).toHaveLength(1);
    expect(dots[0]).toContain("M 0,");
  });

  // A round cap on a zero-length path renders a true circle in SCREEN space,
  // which is the only marker that survives `preserveAspectRatio="none"`.
  it("marks a lone reading between two gaps with a dot", () => {
    const { lines, dots } = sparklineGeometry([null, 7, null], scale);

    expect(lines).toEqual([]);
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatch(/^M ([\d.]+,[\d.]+) L \1$/);
  });

  it("has no line and no marker when nothing was measured at all", () => {
    expect(sparklineGeometry([null, null], scale)).toEqual({ lines: [], dots: [], last: null });
  });

  it("marks the most recent reading, skipping the trailing gap", () => {
    const { last } = sparklineGeometry([4, 9, null], scale);

    // The second point, not the third: the run ends where the data does.
    expect(last).toBe("M 50,2 L 50,2");
  });

  it("lays an all-zero series flat along the floor rather than dividing by zero", () => {
    const { lines } = sparklineGeometry([0, 0, 0], scale);

    expect(lines[0]).toBe("M 0,28 L 50,28 L 100,28");
    expect(numbersIn(lines[0]).every(Number.isFinite)).toBe(true);
  });

  it("puts a single reading in the middle of the box, with no width to spread over", () => {
    const { dots } = sparklineGeometry([3], scale);

    expect(dots[0]).toBe("M 50,2 L 50,2");
  });

  // A rate is read against the whole scale. Auto-scaling 96.4 and 94.1 to the
  // full height of the box turns a two-point dip into a collapse — the
  // truncated-axis anti-pattern, on the one figure this product is judged by.
  it("honours a domain the caller sets, so a rate is not drawn against itself", () => {
    const { lines } = sparklineGeometry([96.4, 94.1], { ...scale, max: 100 });

    const [, y1, , y2] = numbersIn(lines[0]);
    expect(y2 - y1).toBeCloseTo(0.6, 1);
  });

  it("clamps a reading that sits outside the domain instead of drawing outside the box", () => {
    const { lines } = sparklineGeometry([0, 140], { ...scale, max: 100 });

    expect(numbersIn(lines[0]).every((n) => n >= 0 && n <= 100)).toBe(true);
  });
});

describe("formatCount", () => {
  it("groups thousands without asking Intl, which resolves differently in Node and the browser", () => {
    expect(formatCount(12418)).toBe("12,418");
    expect(formatCount(412)).toBe("412");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1000000)).toBe("1,000,000");
  });
});
