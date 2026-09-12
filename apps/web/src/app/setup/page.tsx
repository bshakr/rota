import type { Metadata } from "next";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/admin/sign-out-button";
import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { householdKey, membershipsFor } from "@/lib/auth/household";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up your house" };

/**
 * First run: the one screen between signing in and having a house. It renders
 * inside the bare root layout, outside the admin shell, because there is no
 * household to put a sidebar around yet.
 *
 * Soft Clay: a muted wordmark for chrome, the way not-found and error do it,
 * then one white clay card on the lavender page and nothing else, so the two
 * questions on it are the only things to answer.
 */
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

  // Someone who already belongs somewhere is choosing, not creating, so the
  // card asks a different question.
  const returning = households.length > 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Unlinked on purpose: mid-setup there is nowhere useful to go, and the
          wordmark is here to say who is asking, not to lead away. */}
      <header className="px-5 pt-7 md:px-8">
        <Wordmark muted />
      </header>

      <Container asChild width="member">
        <main className="flex-1 py-10 md:py-14">
          <Card className="animate-pop">
            <CardHeader>
              {/* The page's real heading, wearing the card title's Fredoka. */}
              <CardTitle className="text-xl">
                <h1>{returning ? "Which house?" : "Name your house"}</h1>
              </CardTitle>
              <CardDescription className="text-pretty">
                {returning
                  ? "Pick the one you want, and carry on where you left off."
                  : "Give it a name and check the clock. Housemates and chores come next."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SetupForm households={households} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} />
            </CardContent>
          </Card>

          {/* The way back out, quiet and below the card: signed in as the wrong
              person is the one other thing that can go wrong here. */}
          <div className="mx-auto mt-6 w-fit max-w-full">
            <SignOutButton email={user.email} />
          </div>
        </main>
      </Container>
    </div>
  );
}
