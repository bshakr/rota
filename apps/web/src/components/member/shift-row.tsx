"use client";

import { ArrowRightLeft } from "lucide-react";

import { shiftStateFor } from "@/app/(member)/s/[token]/shift-view";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MemberShift } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One shift on one day of the feed: the job, who is on it, and what the viewer can do
 * about it.
 *
 * A row the viewer is on is LIT — the lemon "now" wash plus a grape outline, the two
 * colours the system already uses for "this is the thing in front of you" — and wears
 * a YOU tag, so a member scanning the whole house's rota finds their own turns without
 * reading a single name. Everyone else's rows stay quiet.
 *
 * Presentational. The two actions are callbacks; this component never calls the API.
 */
export function ShiftRow({
  shift,
  viewerId,
  onHandOff,
  onTakeBack,
}: {
  shift: MemberShift;
  viewerId: number;
  onHandOff: (shift: MemberShift) => void;
  onTakeBack: (shift: MemberShift) => void;
}) {
  const state = shiftStateFor(shift, viewerId);
  const mine = state !== null;
  const person = shift.responsible_member;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
        // The lemon "now" wash at a quarter strength, like every other tint in the
        // system, with the grape outline inset so it never shifts the row's height.
        mine && "bg-lemon/25 outline-2 -outline-offset-2 outline-primary/40",
      )}
    >
      <Avatar size="sm">
        <AvatarFallback className={cn(avatarTint(person.name), "text-foreground text-[10px]")}>
          {initials(person.name)}
        </AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{shift.rota_name}</span>
        <span className="text-muted-foreground block truncate text-sm">
          {shift.covered && shift.covering_member ? (
            <>
              {shift.covering_member.name} covering {shift.assigned_member.name}
            </>
          ) : (
            person.name
          )}
        </span>
      </span>

      {mine ? (
        <Badge variant="warning" className="shrink-0">
          You
        </Badge>
      ) : null}

      {shift.covered ? (
        <Badge variant="info" className="shrink-0">
          <ArrowRightLeft aria-hidden />
          Cover
        </Badge>
      ) : null}

      {/* The two controls are mutually exclusive: the API resolves them for this
          member, and a shift too soon to touch (today's turn) shows neither.
          `size="sm"` sets the TYPE; the height is forced back to 44px because this
          is a phone-first surface and 32px is below the comfortable touch floor. */}
      {shift.can_assign_cover ? (
        <Button
          variant="link"
          size="sm"
          className="h-11 shrink-0 px-0"
          onClick={() => onHandOff(shift)}
        >
          Hand off
        </Button>
      ) : null}

      {shift.can_cancel_cover && shift.covering_member ? (
        <Button
          variant="link"
          size="sm"
          className="h-11 shrink-0 px-0"
          onClick={() => onTakeBack(shift)}
        >
          Take it back
        </Button>
      ) : null}
    </li>
  );
}
