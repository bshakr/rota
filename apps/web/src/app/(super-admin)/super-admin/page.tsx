import type { Metadata } from "next";
import { Telescope } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "HQ" };

/**
 * The landing page of the super admin area, empty by design in this ticket.
 *
 * It deliberately makes NO API call. `getOverview()` exists in
 * src/lib/api/super-admin.ts and is tested, but the endpoint behind it is
 * landing in a parallel PR and answers `{}` in any case, so a call here would
 * add a round trip and a failure mode in exchange for nothing on screen. The
 * KPI tiles, the attention list and the recent-houses list arrive with the query
 * object in https://linear.app/bloombase/issue/BLO-1678.
 *
 * So this page renders the shell and an empty state, and asserts nothing about
 * the API path — that the guard admits the right people is what
 * super-admin.test.ts covers, and what Rails covers for real.
 */
export default function SuperAdminOverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Every house on Rota Monster: how they are doing, what they send, and what they cost."
      />
      <EmptyState
        icon={Telescope}
        title="Nothing to show yet"
        description="Houses, traffic and spend land here as the later phases ship. Nothing is being counted on this page yet."
      />
    </>
  );
}
