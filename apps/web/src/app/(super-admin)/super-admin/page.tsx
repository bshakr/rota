import type { Metadata } from "next";

import { isApiError } from "@/lib/api/errors";
import { getOverview } from "@/lib/api/super-admin";
import { type SuperAdminOverview, isOverviewShapeError } from "@/lib/api/super-admin-overview";

import { OverviewScreen } from "./_components/overview-screen";
import { OverviewUnavailable } from "./_components/overview-unavailable";

export const metadata: Metadata = { title: "HQ" };

// Live, per-request, behind an allowlist — never statically prerendered. The
// payload is cached for a minute in Rails, which is the right place for it: one
// copy serves every operator, and Next has no way to know when a house signs up.
export const dynamic = "force-dynamic";

/**
 * The landing page of the super admin area.
 *
 * It does two things and hands the rest off: it makes the one API call, and it
 * decides what a failure looks like. `OverviewScreen` owns the layout and is
 * given a payload, which is what lets it be rendered from a fixture.
 *
 * The failure policy is the interesting part. `getOverview()` parses the payload
 * rather than casting it, so there are three ways out of that call:
 *
 *   - a redirect or a notFound() thrown by the client (an expired session, a
 *     caller who is not allowlisted). Never caught here — rethrown untouched,
 *     because swallowing a redirect strands the operator on a half-rendered page.
 *   - an ApiError: Rails refused or fell over. An error state.
 *   - an OverviewShapeError: Rails answered, and this page does not recognise the
 *     answer. LOUD IN DEVELOPMENT — rethrown so the Next overlay puts the failing
 *     field on screen the moment a shape drifts — and an error state in
 *     production, where an operator needs a sentence rather than a stack trace.
 *
 * What none of them do is render a dashboard. Every figure on this page is
 * derived, so a missing one does not look missing; it looks like a fact.
 */
export default async function SuperAdminOverviewPage() {
  // One clock for the whole render, passed down rather than read again in each
  // card: every relative time on this page is measured against the same instant,
  // and a `Date.now()` inside a component is a hydration mismatch waiting to
  // happen (see lib/date.ts).
  const now = new Date();

  // The fetch and the render are deliberately NOT nested: JSX built inside a
  // try/catch would put the screen's own render errors in the path of this
  // handler, which is an error boundary's job and not a page's
  // (react-hooks/error-boundaries). So the call is caught, the outcome is a
  // variable, and the JSX is chosen afterwards.
  let overview: SuperAdminOverview | null = null;
  let failure: unknown = null;

  try {
    overview = await getOverview();
  } catch (error) {
    if (isOverviewShapeError(error) && process.env.NODE_ENV !== "production") throw error;
    if (!isApiError(error) && !isOverviewShapeError(error)) throw error;

    failure = error;
  }

  if (overview === null) return <OverviewUnavailable error={failure} />;

  return <OverviewScreen overview={overview} now={now} />;
}
