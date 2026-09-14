import Link from "next/link";
import { Wallet } from "lucide-react";

import { isSuperAdminSurfaceReady } from "@/components/super-admin-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SPEND_HREF = "/super-admin/spend";

/**
 * The spend tile, waiting for its numbers.
 *
 * `spend` is present and null in the payload today — deliberately, so this page
 * can draw the tile now rather than grow a key later. The figures are their own
 * query object (https://linear.app/bloombase/issue/BLO-1683) and the page they
 * belong to is https://linear.app/bloombase/issue/BLO-1684.
 *
 * So this says what will be here, in one quiet line, and does NOT pretend to a
 * number: a placeholder "£0.00" on a cost tile is the single most expensive lie
 * this screen could tell.
 *
 * Whether it links anywhere is not decided here. It asks the nav, which is the
 * one list that knows which surfaces exist — so the ticket that builds the spend
 * page flips one flag and this tile becomes a link, with nothing else to
 * remember. Today that flag is false and the nav shows Spend as "Soon", so the
 * tile is text.
 */
export function SpendTile() {
  const ready = isSuperAdminSurfaceReady(SPEND_HREF);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="bg-lemon grid size-7 shrink-0 place-items-center rounded-full" aria-hidden>
            <Wallet className="text-plum size-3.5" strokeWidth={2.5} />
          </span>
          Spend
        </CardTitle>
        <CardDescription>Texts and Claude, this month against last.</CardDescription>
      </CardHeader>

      <CardContent>
        <p className="text-muted-foreground rounded-xl bg-muted/60 px-4 py-6 text-center text-sm text-pretty">
          Spend arrives with the spend page.{" "}
          {ready ? (
            <Link
              href={SPEND_HREF}
              className="text-link font-medium underline-offset-4 hover:underline"
            >
              Open it
            </Link>
          ) : (
            "Nothing is being counted here yet."
          )}
        </p>
      </CardContent>
    </Card>
  );
}
