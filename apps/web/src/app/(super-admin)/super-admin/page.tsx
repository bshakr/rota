import type { Metadata } from "next";

import { isApiError } from "@/lib/api/errors";
import { getOverview, getSpend } from "@/lib/api/super-admin";
import { type SuperAdminOverview, isOverviewShapeError } from "@/lib/api/super-admin-overview";
import { type OverviewSpend, isSpendShapeError } from "@/lib/api/super-admin-spend";
import { OVERVIEW_SPEND_RANGE, overviewSpend } from "@/lib/hq-spend";

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
 * It does two things and hands the rest off: it makes the API calls, and it
 * decides what a failure looks like. `OverviewScreen` owns the layout and is
 * given its payloads, which is what lets it be rendered from a fixture.
 *
 * TWO calls, not one, and they are not equals. The overview is the page; the
 * spend window behind the corner tile is fetched beside it and is allowed to
 * fail on its own.
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
  // TWO CALLS, STARTED TOGETHER. The spend tile needs figures the overview
  // payload does not carry (`overview.spend` is still Rails' placeholder), so the
  // window they come from is fetched beside it rather than after it: awaiting one
  // and then the other would cost the operator a second round trip for a tile in
  // the corner of the page. Both are cached for a minute in Rails.
  //
  // The spend call is settled into a value rather than left as a rejecting
  // promise, because the overview's own failure path returns early — and an
  // unawaited rejection behind an early return is an unhandled rejection in the
  // server log.
  const spendOutcome = getSpend(OVERVIEW_SPEND_RANGE).then(
    (payload) => ({ payload, error: null as unknown }),
    (error: unknown) => ({ payload: null, error }),
  );

  let overview: SuperAdminOverview | null = null;
  let failure: unknown = null;

  try {
    overview = await getOverview();
  } catch (error) {
    if (isOverviewShapeError(error) && process.env.NODE_ENV !== "production") throw error;
    if (!isApiError(error) && !isOverviewShapeError(error)) throw error;

    if (isOverviewShapeError(error)) {
      // The production half of "fails loudly". Only three people can reach this
      // page, so a shape drift could sit on screen for days before one of them
      // looks; the log is what puts it in front of whoever is watching the deploy
      // that caused it. The rendered state names the fields too, but nobody greps
      // a screenshot.
      console.error(
        "[super-admin/overview] payload did not match the expected shape:",
        error.issues.join("; "),
      );
    }

    failure = error;
  }

  if (overview === null) return <OverviewUnavailable error={failure} />;

  // The spend half fails SOFTLY, and that asymmetry is the point: the overview is
  // the page, and the tile is a tile. A cost figure that could not be counted must
  // never render as a zero, but it must not take the attention list down with it
  // either — the operator came here to see what needs a human.
  //
  // A shape error is still loud in development (the Next overlay names the
  // drifting field) and logged in production, exactly as the overview's is. A
  // redirect or a notFound() thrown by the client is rethrown untouched: an
  // expired session is not a missing tile, it is a page that must not render.
  const { payload: spendPayload, error: spendError } = await spendOutcome;
  let spend: OverviewSpend | null = null;

  if (spendPayload !== null) {
    // Rails' own figures if it ever starts sending them; the 90-day window's last
    // two calendar months otherwise. The union on `overview.spend` is what makes
    // that swap a one-line change rather than a ticket.
    spend = overview.spend ?? overviewSpend(spendPayload);
  } else {
    if (isSpendShapeError(spendError) && process.env.NODE_ENV !== "production") throw spendError;
    if (!isApiError(spendError) && !isSpendShapeError(spendError)) throw spendError;

    console.error("[super-admin/overview] the spend tile could not be counted:", spendError);
  }

  return <OverviewScreen overview={overview} spend={spend} now={now} />;
}
