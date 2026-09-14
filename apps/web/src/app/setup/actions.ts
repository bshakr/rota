"use server";

import { getWorkOS, switchToOrganization, withAuth } from "@workos-inc/authkit-nextjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requestJson } from "@/lib/api/http";
import type { GroupResponse } from "@/lib/api/types";
import { householdKey, initialHousehold, membershipsFor } from "@/lib/auth/household";
import { FIRST_TOUCH_COOKIE, decodeFirstTouch } from "@/lib/first-touch";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return value.length > 0; }
    catch { return false; }
  }),
});

export async function setupHousehold(_state: { error: string }, form: FormData) {
  const auth = await withAuth();
  if (!auth.user) redirect("/auth/sign-in");
  const userId = auth.user.id;
  try {
    let memberships = await membershipsFor(userId);
    const active = memberships.filter((membership) => membership.status === "active");
    const selected = form.get("organizationId");
    let organizationId: string;
    if (typeof selected === "string" && selected) {
      if (!active.some((membership) => membership.organizationId === selected)) {
        return { error: "You no longer have access to that household. Refresh this page to try again." };
      }
      organizationId = selected;
    } else {
      if (active.length) {
        return { error: "You already belong to a household. Refresh this page and choose it to continue." };
      }
      const parsed = schema.safeParse({ name: form.get("name"), timezone: form.get("timezone") });
      if (!parsed.success) return { error: "Enter a household name (up to 100 characters) and a valid timezone." };
      const organization = await initialHousehold(userId, parsed.data.name, parsed.data.timezone);
      organizationId = organization.id;
      memberships = await membershipsFor(userId);
      const existing = memberships.find((membership) => membership.organizationId === organizationId);
      if (existing && existing.status !== "active") {
        return { error: "Your household membership is not active. Ask a household admin to restore access." };
      }
      if (!existing) {
        // A completed onboarding must never reinstate a subsequently removed member.
        if (organization.metadata.setup_membership !== "pending") {
          return { error: "Your previous household membership was removed. Ask a household admin for access." };
        }
        try {
          await getWorkOS().userManagement.createOrganizationMembership({ userId, organizationId });
        } catch (error) {
          const recovered = (await membershipsFor(userId)).some(
            (membership) => membership.organizationId === organizationId && membership.status === "active",
          );
          if (!recovered) throw error;
        }
      }
    }

    // Use the returned token, not withAuth's request-header snapshot (which still
    // contains the old, organization-less session during this server action).
    const session = await switchToOrganization(organizationId, { revalidationStrategy: "none", returnTo: "/setup" });
    if (!session.user || session.organizationId !== organizationId || session.user.id !== userId) {
      return { error: "We couldn't activate your household session. Please sign in again." };
    }
    const organization = await getWorkOS().organizations.getOrganization(organizationId);
    if (organization.externalId === householdKey(userId)) {
      await getWorkOS().organizations.updateOrganization({
        organization: organizationId,
        metadata: { setup_membership: "complete" },
      });
      const { group } = await requestJson<GroupResponse>("/api/group", session.accessToken);
      if (!group.timezone_confirmed) {
        // The naming request, and the one chance to tell the API where this house came from. The
        // campaign was written to a cookie on the visitor's first landing, before WorkOS dropped the
        // query string (src/lib/first-touch.ts); this is where it is handed over and forgotten.
        const cookieStore = await cookies();
        const firstTouch = decodeFirstTouch(cookieStore.get(FIRST_TOUCH_COOKIE)?.value);
        await requestJson("/api/group", session.accessToken, {
          method: "PATCH",
          body: {
            name: organization.name,
            timezone: organization.metadata.setup_timezone,
            ...(firstTouch ? { first_touch: firstTouch } : {}),
          },
        });
        // Handed over, so it has no further job. The API stores a first touch once and refuses to
        // overwrite it, so clearing here is tidiness rather than the guarantee.
        cookieStore.delete(FIRST_TOUCH_COOKIE);
      }
      await getWorkOS().organizations.updateOrganization({
        organization: organizationId,
        metadata: { setup_finished: "true" },
      });
    }
  } catch (error) {
    // AuthKit can redirect to an organization's MFA/SSO challenge while switching.
    unstable_rethrow(error);
    // Never return provider exceptions, tokens, or API configuration to the browser.
    return { error: "We couldn't finish setting up your household. Please try again. Your progress is saved." };
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
