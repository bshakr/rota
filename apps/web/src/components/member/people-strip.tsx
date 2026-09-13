"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ScheduleMember } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Everyone who lives here, as a row of pastel coins. Tapping one narrows the feed to
 * that person; tapping the selected one clears it.
 *
 * An opted-out housemate is MUTED, not hidden. They still live here, and the hand-off
 * sheet is where "can't be texted" is explained; removing them from the strip would
 * read as "they moved out".
 *
 * Phone only. The desktop layout uses PeopleCard, whose rows are the same filter.
 */
export function PeopleStrip({
  members,
  viewerId,
  awayToday,
  selectedId,
  onSelect,
}: {
  members: ScheduleMember[];
  viewerId: number;
  /** Ids of housemates the house calendar has away on the group's today. */
  awayToday: number[];
  selectedId: number | null;
  onSelect: (memberId: number | null) => void;
}) {
  return (
    <div
      // The strip scrolls rather than wrapping: a big house should not push the feed
      // off the first screen. -mx-5 lets it bleed to the gutter edge so the last
      // avatar is visibly cut off, which is what says "there is more".
      className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 md:-mx-8 md:px-8"
      role="group"
      aria-label="Filter by housemate"
    >
      {members.map((member) => {
        const selected = member.id === selectedId;
        const away = awayToday.includes(member.id);
        return (
          <button
            key={member.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : member.id)}
            className={cn(
              "focus-visible:outline-ring flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-2xl py-2 focus-visible:outline-2 focus-visible:outline-offset-2",
              selected && "bg-lemon/25",
              !member.contactable && "opacity-60",
            )}
          >
            {/* The away dot rides ON the avatar rather than sitting beside it: the
                strip is scanned, not read, and "who is not here" has to survive a
                glance. Blush is the sticker sheet's "not as planned" pastel and is
                theme-independent, so the dot is the same object at night. */}
            <span className="relative">
              <Avatar
                size="lg"
                className={cn(
                  selected && "ring-primary ring-offset-background ring-2 ring-offset-2",
                )}
              >
                <AvatarFallback className={cn(avatarTint(member.name), "text-foreground text-sm")}>
                  {initials(member.name)}
                </AvatarFallback>
              </Avatar>
              {away ? (
                <span
                  // A labelled image, not decoration: it folds "Away today" into the
                  // button's accessible name, which is the only place a screen reader
                  // would otherwise never hear it.
                  role="img"
                  aria-label="Away today"
                  className="bg-blush ring-background absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2"
                />
              ) : null}
            </span>
            <span className="w-full truncate px-0.5 text-center text-xs font-medium">
              {member.id === viewerId ? "You" : member.name.split(" ")[0]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
