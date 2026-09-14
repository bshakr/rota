import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { isSuperAdminSurfaceReady } from "@/components/super-admin-nav";

/** Where a house's own dashboard lives. https://linear.app/bloombase/issue/BLO-1676 builds it. */
const GROUPS_HREF = "/super-admin/groups";

/**
 * One house in a list — a link to its dashboard once that page exists, and plain
 * text until then.
 *
 * Both lists on this page name houses, and both would like to send you to the
 * one you are reading about. That page is
 * https://linear.app/bloombase/issue/BLO-1676 and it is not built, so a link
 * today is a link to a 404 — worse than no link, because an operator chasing a
 * failing house learns the tool is broken at the moment they needed it.
 *
 * The flag is not written down here. It is read off SUPER_ADMIN_NAV, which is the
 * one list that knows which surfaces exist, so BLO-1676 flips one boolean and
 * every row in the area becomes a link at once — the same rule the spend tile
 * follows. A second hardcoded "groups isn't built yet" is exactly the thing that
 * ticket would not think to come back and delete.
 *
 * Shared by both lists rather than written twice, so they cannot disagree about
 * whether a house is reachable.
 */
export function HouseRow({ groupId, children }: { groupId: number; children: React.ReactNode }) {
  if (!isSuperAdminSurfaceReady(GROUPS_HREF)) {
    // No hover tint, no chevron, no focus ring: nothing here should look like it
    // would do something if you pressed it.
    return (
      <div className="flex items-center gap-3 px-2 py-3">
        <span className="min-w-0 flex-1">{children}</span>
      </div>
    );
  }

  return (
    <Link
      href={`${GROUPS_HREF}/${groupId}`}
      className="hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-xl px-2 py-3 transition-colors outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}
