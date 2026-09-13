"use client";

import type { FeedEvent } from "@/app/(member)/s/[token]/calendar-view";
import { eventMetaLabel, eventRowLabel } from "@/app/(member)/s/[token]/calendar-view";
import { Badge } from "@/components/ui/badge";

/**
 * One house calendar entry on one day of the feed: a trip someone is on, or a thing
 * happening here.
 *
 * It sits in the same list as the day's shifts and reads deliberately quieter than
 * them — no avatar, no action — because nobody is on the hook for it. A shift is a
 * job; this is context for the jobs around it.
 *
 * Presentational, and there is no interactive control on it: the calendar is read
 * only from the member's side, which is the whole point of connecting one.
 */
export function EventRow({ event }: { event: FeedEvent }) {
  const away = event.kind === "away";
  // "until Thu 1 Oct" for a trip, "19:00" for a dinner — the half of the line that
  // says when, kept muted so the names stay the thing you scan for.
  const meta = eventMetaLabel(event);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
      {/* Away wears the same warning sticker the feed already uses for "this one is
          about you"; a plain event wears the info sticker the Cover tag uses. */}
      <Badge variant={away ? "warning" : "info"}>{away ? "Away" : "Event"}</Badge>

      {/* `basis-48` for the same reason the shift row uses it: on a 390px phone the
          words get the column BEFORE anything else is placed, and they wrap rather
          than truncating. A trip nobody is home for is not worth an ellipsis. */}
      <span className="text-muted-foreground min-w-0 grow basis-48 text-sm text-pretty">
        <span className="text-foreground font-medium">{eventRowLabel(event)}</span>
        {meta ? ` · ${meta}` : null}
      </span>
    </li>
  );
}
