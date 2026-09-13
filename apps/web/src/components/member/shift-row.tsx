"use client";

import { ArrowRightLeft } from "lucide-react";

import { shiftInvolves } from "@/app/(member)/s/[token]/schedule-view";
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
  // Only nullity is wanted here — the row says "yours" with a tag and a tint, not
  // with the three-way vocabulary — so ask the predicate rather than building a
  // ShiftState and throwing it away.
  const mine = shiftInvolves(shift, viewerId);
  const person = shift.responsible_member;

  return (
    <li
      // The feed scrolls this row into view after a cover lands, which can be six
      // weeks down the page. An id on the row is what makes that findable.
      data-shift-row={shift.id}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3",
        // The lemon "now" wash at a quarter strength, like every other tint in the
        // system, with the grape outline inset so it never shifts the row's height.
        mine && "bg-lemon/25 outline-2 -outline-offset-2 outline-primary/40",
      )}
    >
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback className={cn(avatarTint(person.name), "text-foreground text-[10px]")}>
          {initials(person.name)}
        </AvatarFallback>
      </Avatar>

      {/* NOTHING here truncates except a person's name, and only when that one name is
          genuinely wider than the column. The rota name wraps, the cover sentence
          wraps, and the tags wrap under it — a phone is 390px and "Kitche…" / "Eliza
          c…" told the member nothing at all. `basis-48` is what buys the column that
          room: it is the width the row asks for BEFORE the action button is placed, so
          the button takes what is left over rather than squeezing the words. */}
      <span className="min-w-0 grow basis-48">
        <span className="block font-medium text-pretty">{shift.rota_name}</span>

        {/* The tags belong to this line, not to the row's right edge: "Eliza covering
            Ciara" and the COVER tag are one fact, and on a phone they have to be able
            to fall onto a line of their own together. */}
        <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="min-w-0">
            {shift.covered && shift.covering_member ? (
              <>
                <PersonName name={shift.covering_member.name} /> covering{" "}
                <PersonName name={shift.assigned_member.name} />
              </>
            ) : (
              <PersonName name={person.name} />
            )}
          </span>

          {mine ? <Badge variant="warning">You</Badge> : null}

          {shift.covered ? (
            <Badge variant="info">
              <ArrowRightLeft aria-hidden />
              Cover
            </Badge>
          ) : null}
        </span>
      </span>

      {/* The two controls are mutually exclusive: the API resolves them for this
          member, and a shift too soon to touch (today's turn) shows neither.
          `size="sm"` sets the TYPE; the height is forced back to 44px because this
          is a phone-first surface and 32px is below the comfortable touch floor.
          `ml-auto` keeps it at the row's right edge whether it sits beside the words
          or wraps onto its own line beneath them. */}
      {/* data-shift-action marks whichever control this row currently offers, so the
          hand-off sheet can hand focus back to the row it came from — by then the
          "Hand off" it was opened from has been replaced by "Take it back". */}
      {shift.can_assign_cover ? (
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-11 shrink-0 px-0"
          data-shift-action={shift.id}
          onClick={() => onHandOff(shift)}
        >
          Hand off
        </Button>
      ) : null}

      {shift.can_cancel_cover && shift.covering_member ? (
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-11 shrink-0 px-0"
          data-shift-action={shift.id}
          onClick={() => onTakeBack(shift)}
        >
          Take it back
        </Button>
      ) : null}
    </li>
  );
}

/**
 * A person's name, and the ONE thing on this row allowed to end in an ellipsis. It is
 * an inline-block so the sentence around it still wraps at its spaces; the truncation
 * only ever bites when a single name is wider than the whole column.
 */
function PersonName({ name }: { name: string }) {
  return <span className="inline-block max-w-full truncate align-bottom">{name}</span>;
}
