/**
 * The arithmetic behind `components/charts/*` — every number a chart needs
 * before it can be drawn, as pure functions.
 *
 * It lives apart from the components for one reason: geometry is where a chart
 * goes quietly wrong. A week in which nothing happened divides by zero, an
 * empty range has no maximum, a series of nulls has no line — and each of those
 * renders as `width: NaN%` or a `d="M NaN,NaN"` that the browser silently drops.
 * A blank chart looks exactly like a quiet week. So the arithmetic is here,
 * where it can be tested against those cases directly (`charts.test.ts`), and
 * the components stay markup.
 *
 * Two rules hold throughout, and both are dataviz rules rather than taste:
 *
 *   - ZERO BASELINE. Magnitude is read off the length of a mark, so the scale
 *     starts at zero unless the caller passes a floor of its own. A bar chart
 *     whose axis starts at 94 turns a two-point dip into a cliff.
 *   - NEVER NaN. Every divisor is checked. "Nothing to show" is zero-length,
 *     which is a true statement about the data, not an absent element.
 */

/** The one datum shape both charts take: a name and a number, or a hole. */
export type ChartPoint = {
  label: string;
  /** Null is "not measured", drawn as a gap — never as zero. */
  value: number | null;
};

/** Percentages are rendered into `style.width` and `d` attributes; keep them short. */
const round = (n: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
};

/**
 * Each value as a percentage of the largest in the set — the width of a bar in
 * a single-series bar chart.
 *
 * Nulls pass through as null (the bar is not drawn at all, and the component
 * says why in words). An all-zero or all-null set yields zeros rather than
 * NaN: on a week when nothing was sent, every bar is empty, which is the
 * truth.
 *
 * Negative values are not a thing this product counts, and a negative bar
 * drawn leftwards from a left-aligned baseline would be a lie about the
 * geometry, so they are floored at zero.
 */
export function barPercents(values: readonly (number | null)[]): (number | null)[] {
  const max = values.reduce<number>((top, value) => (value !== null && value > top ? value : top), 0);

  return values.map((value) => {
    if (value === null) return null;
    if (max <= 0) return 0;
    return round((Math.max(0, value) / max) * 100);
  });
}

/**
 * Each value as a percentage of the row's own total — the segments of one
 * stacked bar.
 *
 * A week with no texts at all is the case this exists for: the total is zero,
 * there is nothing to divide by, and every segment is zero-width. The row still
 * renders (an empty track), because a missing row would make the x-axis change
 * shape between two ranges.
 */
export function stackShares(values: readonly number[]): number[] {
  const positive = values.map((value) => Math.max(0, value));
  const total = positive.reduce((sum, value) => sum + value, 0);

  if (total <= 0) return positive.map(() => 0);

  return positive.map((value) => round((value / total) * 100));
}

export type SparklineGeometry = {
  /** One `d` per unbroken run of two or more points. Gaps are separate runs. */
  lines: string[];
  /**
   * One `d` per point that has no neighbour to join — a single reading between
   * two gaps. Drawn as a ZERO-LENGTH path with a round cap, which renders as a
   * true circle in screen space however the viewBox is stretched; an actual
   * `<circle>` would be squashed into an ellipse by `preserveAspectRatio="none"`.
   */
  dots: string[];
  /** The most recent point, marked the same way. Null when there is none. */
  last: string | null;
};

export type SparklineScale = {
  width?: number;
  height?: number;
  /** Vertical inset so a 2px stroke at the extremes is not clipped by the viewBox. */
  pad?: number;
  /** The floor of the value axis. Zero unless the caller knows better. */
  min?: number;
  /** The ceiling. Defaults to the largest value present. */
  max?: number;
};

/**
 * A sparkline's path data: the line, its gaps, and the marker on the last
 * reading.
 *
 * Left to right in the order given, which is the order the API sends (oldest
 * first). The caller owns the domain: counts take the default zero floor, and a
 * percentage passes `max: 100` so a 96%-to-94% week reads as the flat line it
 * is rather than as a collapse.
 *
 * A series with no height at all — every week zero, which is a real week on a
 * young product — is drawn flat along the FLOOR rather than dividing by a
 * zero-height domain. Flat on the baseline is what "nothing happened" looks
 * like; anywhere else would invent a reading.
 */
export function sparklineGeometry(
  values: readonly (number | null)[],
  { width = 100, height = 30, pad = 2, min, max }: SparklineScale = {},
): SparklineGeometry {
  const present = values.filter((value): value is number => value !== null);

  const floor = min ?? 0;
  const ceiling = max ?? (present.length > 0 ? Math.max(floor, ...present) : floor);
  // A domain of zero height would divide by zero. One unit of span keeps the
  // arithmetic finite and leaves every reading on the floor, which is where an
  // all-zero series belongs.
  const base = floor;
  const span = ceiling - floor || 1;

  const plot = Math.max(0, height - pad * 2);
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const pointAt = (index: number, value: number) => {
    const x = values.length > 1 ? index * step : width / 2;
    const clamped = Math.min(Math.max(value, base), base + span);
    const y = pad + plot - ((clamped - base) / span) * plot;
    return `${round(x, 2)},${round(y, 2)}`;
  };

  const lines: string[] = [];
  const dots: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length >= 2) lines.push(`M ${run.join(" L ")}`);
    // A zero-length path: "M x,y L x,y". With stroke-linecap="round" that is a
    // dot, and with vector-effect="non-scaling-stroke" it is a round one.
    else if (run.length === 1) dots.push(`M ${run[0]} L ${run[0]}`);
    run = [];
  };

  values.forEach((value, index) => {
    if (value === null) {
      flush();
      return;
    }
    run.push(pointAt(index, value));
  });
  flush();

  // The most recent reading, which is not the same as the last element: a
  // trailing gap must not take the marker with it.
  let last: string | null = null;
  values.forEach((value, index) => {
    if (value === null) return;
    const point = pointAt(index, value);
    last = `M ${point} L ${point}`;
  });

  return { lines, dots, last };
}

/**
 * A count as a chart prints it: "412", "12,418".
 *
 * Grouped by hand rather than through `Intl.NumberFormat`, for the reason
 * `lib/date.ts` spells out at length — Node's ICU and a browser's ICU ship
 * different CLDR revisions, and a formatter that resolves differently on the
 * two sides of a hydration boundary is a mismatch on every figure the page
 * draws. Digit grouping is pure arithmetic, so it is done here.
 */
export function formatCount(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
