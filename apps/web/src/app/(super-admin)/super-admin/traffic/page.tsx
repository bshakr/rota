import type { Metadata } from "next";

import { isApiError } from "@/lib/api/errors";
import { getTraffic } from "@/lib/api/super-admin";
import { type SuperAdminTraffic, isTrafficShapeError } from "@/lib/api/super-admin-traffic";
import { parseRange } from "@/lib/hq-traffic";

import { TrafficScreen } from "./_components/traffic-screen";
import { TrafficUnavailable } from "./_components/traffic-unavailable";

export const metadata: Metadata = { title: "Traffic" };

// Live, per-request, behind an allowlist — never statically prerendered. The
// payload is cached for a minute in Rails, which is the right place for it: one
// copy serves every operator, and Next has no way to know when a house signs up.
export const dynamic = "force-dynamic";

/**
 * The traffic dashboard: is the product converting, and is it doing anything for
 * the houses that made it through?
 *
 * It does three things and hands the rest off: it resolves the window from the
 * URL, it makes the one API call, and it decides what a failure looks like.
 * `TrafficScreen` owns the layout and is given a payload, which is what lets it
 * be rendered from a fixture.
 *
 * THE RANGE IS THE URL. `?range=` is read here, on the server, and validated
 * down to one of three windows before anything is fetched — so the picker is
 * three links rather than a client component, and a window is bookmarkable and
 * shareable. An unrecognised range falls back to thirty days rather than being
 * forwarded: Rails answers 400 for one it does not know, and a stale bookmark
 * deserves figures rather than an error page.
 *
 * The failure policy is `/super-admin`'s, deliberately — the same three ways out
 * of the call, answered the same way:
 *
 *   - a redirect or notFound() thrown by the client. Rethrown untouched;
 *     swallowing a redirect strands the operator on a half-rendered page.
 *   - an ApiError: Rails refused or fell over. An error state.
 *   - a TrafficShapeError: Rails answered and this page does not recognise the
 *     answer. LOUD IN DEVELOPMENT, an error state in production.
 *
 * What none of them do is render a dashboard. Every figure on this page is
 * derived, so a missing one does not look missing; it looks like a fact.
 */
export default async function SuperAdminTrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseRange((await searchParams).range);

  // One clock for the whole render, passed down rather than read again in each
  // card: every relative time on this page is measured against the same instant,
  // and a `Date.now()` inside a component is a hydration mismatch waiting to
  // happen (see lib/date.ts).
  const now = new Date();

  // The fetch and the render are deliberately NOT nested: JSX built inside a
  // try/catch would put the screen's own render errors in the path of this
  // handler, which is an error boundary's job and not a page's.
  let traffic: SuperAdminTraffic | null = null;
  let failure: unknown = null;

  try {
    traffic = await getTraffic(range);
  } catch (error) {
    if (isTrafficShapeError(error) && process.env.NODE_ENV !== "production") throw error;
    if (!isApiError(error) && !isTrafficShapeError(error)) throw error;

    if (isTrafficShapeError(error)) {
      // The production half of "fails loudly". Only three people can reach this
      // page, so a shape drift could sit on screen for days before one of them
      // looks; the log is what puts it in front of whoever is watching the
      // deploy that caused it.
      console.error(
        "[super-admin/traffic] payload did not match the expected shape:",
        error.issues.join("; "),
      );
    }

    failure = error;
  }

  if (traffic === null) return <TrafficUnavailable error={failure} range={range} />;

  return <TrafficScreen traffic={traffic} now={now} />;
}
