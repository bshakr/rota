import { DoorOpen, Timer } from "lucide-react";

import { LedgerTile } from "@/components/ledger-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuperAdminTraffic } from "@/lib/api/super-admin-traffic";
import { formatMedianHours, leakNote, medianHoursNote } from "@/lib/hq-traffic";

/**
 * The two questions a funnel cannot answer: how long the product takes to do
 * anything for a house, and how many people it lost before it got the chance.
 *
 * Both are LEDGER TILES — the same object the house dashboard's hero and the
 * overview's KPI row use — because they are the same kind of fact, and a third
 * design for a number would say otherwise.
 *
 * The median wears the lemon "now" coin and the leak wears blush, the "went
 * wrong" sticker. That is a semantic choice, not decoration: people who signed
 * in and made nothing are the one figure on this page that is straightforwardly
 * bad news.
 */
export function ConversionAside({
  median,
  sample,
  signedInWithoutHouse,
}: {
  median: SuperAdminTraffic["median_hours_to_first_text"];
  sample: number;
  signedInWithoutHouse: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Time, and the leak</CardTitle>
        <CardDescription>
          What the funnel&apos;s shape does not show: how long the product took, and who never
          reached it at all.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {/* The quiet fill rather than the tile's default card white: these two
              sit INSIDE a card, where a white tile is a white rectangle on a
              white rectangle. Recessed is also what the small multiples further
              down the page do with the same problem. */}
          <LedgerTile
            className="bg-muted shadow-none"
            icon={Timer}
            coin="lemon"
            value={formatMedianHours(median)}
            label="median to a first text"
            note={medianHoursNote(median, sample)}
          />
          <LedgerTile
            className="bg-muted shadow-none"
            icon={DoorOpen}
            coin="blush"
            value={signedInWithoutHouse}
            label="signed in, no house"
            note={leakNote(signedInWithoutHouse)}
            noteTone={signedInWithoutHouse > 0 ? "alert" : "quiet"}
          />
        </ul>

        <p className="text-muted-foreground mt-4 text-xs text-pretty">
          The median only counts houses that got all the way to a delivered reminder inside this
          window, so it flatters the product by leaving out the ones still stuck — the shorter the
          range, the more it flatters. The leak is read as of now: somebody who signed in on Tuesday
          and made their house on Wednesday is not in it.
        </p>
      </CardContent>
    </Card>
  );
}
