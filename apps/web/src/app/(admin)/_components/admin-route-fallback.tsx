import { Skeleton } from "@/components/ui/skeleton";

/**
 * What stands in the main column while the (admin) layout waits to find out whether the house is
 * paused.
 *
 * DELIBERATELY NEUTRAL. At this point the layout does not yet know whether the next thing on
 * screen is the app or the paused notice, so it must not promise either: three quiet cards are the
 * same idiom as the app's root `loading.tsx`, they say "in a moment" and nothing more. The moment
 * the question is settled the route's own `loading.tsx` takes over with the shape of the actual
 * page, so this is the shortest-lived placeholder in the product and never the one an admin
 * watches.
 *
 * No `Container` of its own: `AdminShell` already renders the page gutter around its children, and
 * a second one inside it would inset the placeholder further than the page it stands in for.
 *
 * `role="status"` with `aria-busy` and a label, which the root skeleton omits: this one replaces
 * the whole of a screen a reader has just navigated to, so it has to be announced as a wait rather
 * than pass as an empty page.
 */
export function AdminRouteFallback() {
  return (
    <div role="status" aria-busy aria-label="Loading">
      <Skeleton className="mb-8 h-8 w-48 rounded-full" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
