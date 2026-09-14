import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FUNNEL_STEPS, type RecentHouse } from "@/lib/api/super-admin-overview";
import { relativeTime } from "@/lib/date";
import { FUNNEL_STEP_LABELS, UNTRACKED_LEADING_STEPS, stepCaption } from "@/lib/hq-overview";
import { cn } from "@/lib/utils";

import { HouseRow } from "./house-row";

/**
 * The last ten houses made, each with the furthest rung of onboarding it reached,
 * so a stalled sign-up is visible the day it happens rather than in a monthly
 * total.
 *
 * FURTHEST, not latest: the highest rung reached whether or not the ones below it
 * were. A house that is texting reminders has plainly got past "added a
 * housemate" even if nobody ever confirmed its timezone.
 */
export function RecentHouses({ houses, now }: { houses: RecentHouse[]; now: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>New houses</CardTitle>
        <CardDescription>{describe(houses.length)}</CardDescription>
      </CardHeader>

      <CardContent>
        {houses.length === 0 ? (
          <p className="text-muted-foreground rounded-xl bg-muted/60 px-4 py-6 text-center text-sm">
            No houses yet. The first one to sign up lands here.
          </p>
        ) : (
          <>
            <ul className="divide-border -mx-2 divide-y">
              {houses.map((house) => (
                <li key={house.group_id}>
                  <HouseRow groupId={house.group_id}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-heading text-sm font-semibold break-words">
                        {house.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {relativeTime(new Date(house.created_at), now)}
                      </span>
                    </span>
                    <StepIndicator reached={house.furthest_step_number} />
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {stepCaption(house.furthest_step_number)} &middot;{" "}
                      {FUNNEL_STEP_LABELS[house.furthest_step]}
                    </span>
                  </HouseRow>
                </li>
              ))}
            </ul>

            {/* Said once, under the list, rather than on every row. */}
            <p className="text-muted-foreground mt-4 text-xs text-pretty">
              Steps 1 and 2 — landing views and signing in — aren&apos;t counted on this page yet,
              so every house starts at step {UNTRACKED_LEADING_STEPS + 1}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The card's subtitle. "The last 0" is not a sentence, so zero gets its own. */
function describe(count: number): string {
  if (count === 0) return "The last ten houses to sign up will land here.";
  if (count === 1) return "The most recent one, and how far it got.";
  return `The last ${count}, and how far each of them got.`;
}

/**
 * The ladder as pips: two hollow ones for the steps nothing counts yet, then the
 * six the query can derive, filled as far as this house got.
 *
 * Eight pips rather than six because the funnel everyone else reads has eight
 * steps. Renumbering "made a house" to step 1 here would quietly make this page
 * disagree with the plan and, later, with the traffic dashboard. The hollow pair
 * shows the gap instead of hiding it.
 *
 * `aria-hidden`: the caption beneath says the same thing in words, and eight
 * unlabelled dots are noise to a screen reader.
 */
function StepIndicator({ reached }: { reached: number }) {
  return (
    <span className="mt-1.5 flex items-center gap-1" aria-hidden>
      {Array.from({ length: UNTRACKED_LEADING_STEPS }, (_, index) => (
        <span key={`untracked-${index}`} className="border-input size-2 rounded-full border" />
      ))}
      {FUNNEL_STEPS.map((step, index) => (
        <span
          key={step}
          className={cn("size-2 rounded-full", index < reached ? "bg-primary" : "bg-muted")}
        />
      ))}
    </span>
  );
}
