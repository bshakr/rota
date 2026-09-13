"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MemberShift, ScheduleMember } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { formatShiftDate } from "@/lib/date";
import { initials } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

/**
 * The desktop sidebar's people list. Same filter as the phone's people strip, but with
 * room to say what each person is next down for, which is the question you ask just
 * before you decide who to text.
 */
export function PeopleCard({
  members,
  viewerId,
  nextShifts,
  selectedId,
  onSelect,
}: {
  members: ScheduleMember[];
  viewerId: number;
  /** Each person's next responsible shift, keyed by member id. */
  nextShifts: Map<number, MemberShift>;
  selectedId: number | null;
  onSelect: (memberId: number | null) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-sm">People</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <ul>
          {members.map((member) => {
            const selected = member.id === selectedId;
            const next = nextShifts.get(member.id);
            return (
              <li key={member.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : member.id)}
                  className={cn(
                    "hover:bg-accent focus-visible:outline-ring flex w-full items-center gap-3 px-4 py-2.5 text-left -outline-offset-2 focus-visible:outline-2",
                    selected && "bg-lemon/25",
                    !member.contactable && "opacity-60",
                  )}
                >
                  <Avatar size="sm">
                    <AvatarFallback
                      className={cn(avatarTint(member.name), "text-foreground text-[10px]")}
                    >
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {member.id === viewerId ? `${member.name} (you)` : member.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {next
                        ? `${next.rota_name} · ${formatShiftDate(civilDate(next.due_on))}`
                        : "Nothing coming up"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
