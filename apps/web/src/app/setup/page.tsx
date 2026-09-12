import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/admin/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { householdKey, membershipsFor } from "@/lib/auth/household";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  const { user, organizationId } = await withAuth();
  if (!user) redirect("/auth/sign-in");
  const memberships = await membershipsFor(user.id);
  const households = memberships.filter((membership) => membership.status === "active")
    .map((membership) => ({ id: membership.organizationId, name: membership.organizationName }));
  if (households.some((household) => household.id === organizationId)) {
    const organization = await getWorkOS().organizations.getOrganization(organizationId!);
    if (organization.externalId !== householdKey(user.id) || organization.metadata.setup_finished === "true") {
      redirect("/dashboard");
    }
  }
  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-16">
      <Card>
        <CardHeader>
          <CardTitle>{households.length ? "Choose your household" : "Set up your household"}</CardTitle>
          <CardDescription>{households.length
            ? "Continue with a household you already belong to."
            : "Give your house a name and check when reminders should arrive. You can add people and your first rota next."}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm households={households} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} />
        </CardContent>
      </Card>
      <SignOutButton email={user.email} />
    </main>
  );
}
