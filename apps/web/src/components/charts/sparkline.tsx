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
 * It is deliberately NOT interactive: no tooltip, no hover layer, no client
 * JavaScript. Every sparkline on the traffic dashboard is published beside its
 * latest value and backed by a table of the same numbers, so there is nothing a
 * hover would reveal that is not already on the page — and an operator
 * dashboard should not ship a bundle to draw a 30px line.
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
   * What the line is of, for a screen reader — "Covers per week, 12 weeks".
   * Required: an unlabelled `role="img"` is an announced nothing.
   */
  label: string;
  className?: string;
}) {
  const { lines, dots, last } = sparklineGeometry(
    points.map((point) => point.value),
    { ...BOX, ...domain },
  );

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
      aria-label={label}
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
    </svg>
  );
}
