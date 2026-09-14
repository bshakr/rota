import Link from "next/link";

import { Container } from "@/components/container";
import { HousePausedNote } from "@/components/house-paused";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wordmark } from "@/components/wordmark";
import type { PublicHousehold } from "@/lib/api/household-entry";

import { EntryForm } from "./entry-form";

/**
 * The household entry page, given a household rather than fetching one.
 *
 * Split out of `page.tsx` by https://linear.app/bloombase/issue/BLO-1676 for the
 * same reason `OverviewScreen` and `GroupsScreen` are split from their pages: the
 * page owns the request, the screen owns the layout, and a screen that takes a
 * payload can be rendered from a fixture — which is the only way to photograph
 * the paused state, since getting a real one would mean suspending a real house.
 */
export function EntryScreen({ household }: { household: PublicHousehold }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/" prefetch={false}>
          <Wordmark muted />
        </Link>
      </header>
      <Container asChild width="member">
        <main className="flex-1 py-10 md:py-14">
          <Card className="animate-pop">
            <CardHeader>
              <CardTitle className="text-xl">
                <h1 className="break-words">{household.name}</h1>
              </CardTitle>
              <CardDescription className="text-pretty">
                {/* A paused house (https://linear.app/bloombase/issue/BLO-1675)
                    hands out no links, so this line would otherwise make a
                    promise the page cannot keep. The house is still NAMED above,
                    so somebody who followed a link knows they found the right
                    place. */}
                {household.paused
                  ? "Your house, your rota. Resting for now."
                  : "Your house, your rota. Get a private link to see what’s yours to do. Your admin needs to add your number first."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* The form is not disabled, it is GONE. `request_link` still
                  answers 202 for a paused house and simply queues nothing — which
                  is right for the endpoint (it must say nothing about the house
                  or the number) and wrong as an experience: a number typed into a
                  box that silently does nothing is worse than no box. */}
              {household.paused ? <HousePausedNote /> : <EntryForm slug={household.slug} />}
            </CardContent>
          </Card>
          <p className="text-muted-foreground mt-6 text-center text-sm">
            Manage this household?{" "}
            <Link href="/dashboard" prefetch={false} className="text-link underline">
              Admin sign in
            </Link>
          </p>
        </main>
      </Container>
    </div>
  );
}
