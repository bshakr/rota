import { type ChartPoint, type SparklineScale, sparklineGeometry } from "@/lib/charts";
import { cn } from "@/lib/utils";

/**
 * A SPARKLINE: one series, inline, no axes, drawn in `currentColor`.
 *
 * Inline SVG rather than a library, because the shape of a series is a
 * polyline and the lint would fight anything that ships its own colours.
 * Everything it draws is `stroke="currentColor"`, so the caller colours it by
 * setting text colour — `text-link` for the ordinary case — and it follows the
 * theme for free.
 *
 * THREE THINGS IT DOES THAT A NAIVE SPARKLINE GETS WRONG:
 *
 *   - It has a ZERO BASELINE by default. A line drawn between its own minimum
 *     and maximum turns a 96.4% to 94.1% dip into a collapse. Pass
 *     `domain={{ max: 100 }}` for a percentage and the shape tells the truth.
 *   - A GAP IS A GAP. A week with nothing to measure — no texts settled, so no
 *     delivery rate — breaks the line rather than being drawn as zero. "None
 *     arrived" and "none were sent" are opposite facts.
 *   - The STROKE DOES NOT STRETCH. The box is stretched to whatever width it is
 *     given (`preserveAspectRatio="none"`), which would otherwise squash a 2px
 *     line to a hairline and turn a round marker into an ellipse.
 *     `vector-effect="non-scaling-stroke"` keeps every stroke measured in screen
 *     pixels, and the markers are zero-length paths with round caps rather than
 *     circles for exactly the same reason.
 *
 * EVERY POINT CARRIES ITS OWN LABEL, in two places. Each bucket gets a
 * transparent hit strip with an SVG `<title>`, which is a native hover tooltip
 * naming that point — "Week of 31 Aug: 22" — with no client JavaScript and no
 * bundle; and the accessible name names the two ends, because "a line" tells a
 * screen reader nothing about where it starts or where it got to. That is what
 * `ChartPoint.label` is for, and why it is required.
 *
 * Beyond those it is deliberately NOT interactive: no crosshair, no pinned
 * tooltip, no state. Every sparkline on the traffic dashboard is published
 * beside its latest value and backed by a table of the same numbers, so there is
 * nothing a richer hover layer would reveal that is not already on the page.
 *
 * Generic on purpose — the group dashboard
 * (https://linear.app/bloombase/issue/BLO-1680) draws its own series from this.
 * Points in, a line out; it knows nothing about weeks or traffic.
 */

/** The viewBox. Stretched horizontally; the height is what `className` sets. */
const BOX: Required<Pick<SparklineScale, "width" | "height" | "pad">> = {
  width: 100,
  height: 30,
  pad: 2,
};

export function Sparkline({
  points,
  domain,
  label,
  className,
}: {
  /** Oldest first, one per bucket. `value: null` is a gap, never a zero. */
  points: readonly ChartPoint[];
  /** The value axis. Floor is zero unless you say otherwise; ceiling is the data's own. */
  domain?: { min?: number; max?: number };
  /**
   * What the line is of, for a screen reader — "Covers per week, 12 weeks". The
   * two end points are appended to it here, so the caller does not repeat them.
   * Required: an unlabelled `role="img"` is an announced nothing.
   */
  label: string;
  className?: string;
}) {
  const { lines, dots, last } = sparklineGeometry(
    points.map((point) => point.value),
    { ...BOX, ...domain },
  );

  // The hit strips: one per bucket, each half a step either side of its point, so
  // the target is the whole column rather than a 2px line. `fill="transparent"`
  // rather than `fill="none"`, because only the former is hit-tested.
  const step = points.length > 1 ? BOX.width / (points.length - 1) : BOX.width;
  const strips = points.map((point, index) => {
    const centre = points.length > 1 ? index * step : BOX.width / 2;
    const x = Math.max(0, centre - step / 2);

    return {
      key: `${index}-${point.label}`,
      x,
      width: Math.min(BOX.width, centre + step / 2) - x,
      // A gap says so rather than reading as a zero, here as everywhere else.
      title: `${point.label}: ${point.value === null ? "no reading" : point.value}`,
    };
  });

  const first = points.at(0);
  const newest = points.at(-1);
  const ends =
    first && newest && first !== newest
      ? ` From ${strips[0].title} to ${strips[strips.length - 1].title}.`
      : first
        ? ` ${strips[0].title}.`
        : "";

  const stroke = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };

  return (
    <svg
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}.${ends}`}
      className={cn("text-link h-8 w-full overflow-visible", className)}
    >
      {lines.map((d) => (
        <path key={d} d={d} strokeWidth={2} {...stroke} />
      ))}
      {/* A reading with no neighbour to join. Without this a single week's
          figure between two gaps would draw nothing at all. */}
      {dots.map((d) => (
        <path key={d} d={d} strokeWidth={4} {...stroke} />
      ))}
      {/* The most recent reading, marked so the eye lands on "now" — the one
          point on a sparkline anybody looks for. */}
      {last ? <path d={last} strokeWidth={5} {...stroke} /> : null}
      {/* Drawn last so they sit above the line and win the hover. Invisible, and
          `aria-hidden` because the accessible name already carries the series —
          a screen reader should not have to walk thirteen strips to hear it. */}
      {strips.map((strip) => (
        <rect
          key={strip.key}
          x={strip.x}
          y={0}
          width={strip.width}
          height={BOX.height}
          fill="transparent"
          aria-hidden
        >
          <title>{strip.title}</title>
        </rect>
      ))}
    </svg>
  );
}
