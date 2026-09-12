import "server-only";

import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { cache } from "react";

// Guard the data layer too: Next can render layouts and pages concurrently.
export const requireHousehold = cache(async () => {
  const auth = await withAuth();
  if (!auth.user) redirect("/auth/sign-in");
  if (!auth.organizationId) redirect("/setup");
  return auth;
});

export async function membershipsFor(userId: string) {
  const memberships = await getWorkOS().userManagement.listOrganizationMemberships({
    userId,
    statuses: ["active", "inactive", "pending"],
  });
  return memberships.autoPagination();
}

// WorkOS enforces external ID uniqueness, including across concurrent requests.
// This key comes ONLY from the authenticated user, never from the submitted form.
export function householdKey(userId: string) {
  return `rotamonster:first:${userId}`;
}

export async function initialHousehold(userId: string, name: string, timezone: string) {
  const organizations = getWorkOS().organizations;
  const externalId = householdKey(userId);
  try {
    return await organizations.getOrganizationByExternalId(externalId);
  } catch (error) {
    if (!(error && typeof error === "object" && "status" in error && error.status === 404)) {
      throw error;
    }
  }
  try {
    return await organizations.createOrganization({
      name,
      externalId,
      metadata: { setup_timezone: timezone, setup_membership: "pending" },
    });
  } catch (error) {
    // Covers both a racing create and a timeout after WorkOS committed the create.
    try {
      return await organizations.getOrganizationByExternalId(externalId);
    } catch {
      throw error;
    }
  }
}
