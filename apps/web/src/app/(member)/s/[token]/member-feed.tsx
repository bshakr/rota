"use client";

import * as React from "react";
import { CalendarX, Filter } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FilterChips } from "@/components/member/filter-chips";
import { HandOffSheet } from "@/components/member/hand-off-sheet";
import { NextShiftCard } from "@/components/member/next-shift-card";
import { PeopleCard } from "@/components/member/people-card";
import { PeopleStrip } from "@/components/member/people-strip";
import { WeekSection } from "@/components/member/week-section";
import { Button } from "@/components/ui/button";
import { toastApiError } from "@/lib/api/toast";
import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";

import { awayMemberIdsOn } from "./calendar-view";
import type { RotaFilter } from "./schedule-view";
import { ALL_SHIFTS, buildFeed, nextShiftByMember, nextUp, weekStart } from "./schedule-view";
import type { AssignAction, CancelAction } from "./use-shift-updates";
import { runAction, useShiftUpdates } from "./use-shift-updates";

// The interactive half of the member page: the whole house's rota, the filters over
// it, and the one thing a member came to do — hand a shift on, or take it back.
//
// It never sees the magic-link token. The two mutations arrive already bound to it
// (server-side, in page.tsx), so this component supplies only shift and member ids.
// Each successful mutation returns the shift resolved for THIS member, and the row
// re-renders from that one authoritative value.

// Four weeks up front. The payload covers the generator's whole 90-day window, so
// "Show more weeks" reveals the rest with no request — a member on a train should not
// need a second round trip to see October.
const INITIAL_WEEKS = 4;

export function MemberFeed({
  schedule,
  assignAction,
  cancelAction,
}: {
  schedule: MemberScheduleResponse;
  assignAction: AssignAction;
  cancelAction: CancelAction;
}) {
  const { shifts, applyUpdate } = useShiftUpdates(schedule.shifts);
  // One schedule object carrying the LIVE shifts, so every derived view (the feed, the
  // "You" card, the people card, the hand-off ranking) reads the same array after a
  // cover lands, rather than some of them reading the server's first answer.
  const live = React.useMemo<MemberScheduleResponse>(
    () => ({ ...schedule, shifts }),
    [schedule, shifts],
  );

  const [rotaFilter, setRotaFilter] = React.useState<RotaFilter>(ALL_SHIFTS.rota);
  const [personId, setPersonId] = React.useState<number | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [takingBack, setTakingBack] = React.useState<MemberShift | null>(null);

  // The hand-off sheet's open state is SEPARATE from the shift it is about. Nulling
  // the shift to close it would unmount the Radix root in the same commit: no exit
  // animation, no onCloseAutoFocus, and focus dumped on <body>. So the sheet closes
  // with open=false and keeps its shift until the close has finished.
  const [handingOff, setHandingOff] = React.useState<MemberShift | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // The row to hand focus back to once the sheet is gone, set only when a hand-off
  // actually landed. After one, the "Hand off" button that opened the sheet no longer
  // exists — the same row now offers "Take it back" — so Radix's own focus restore
  // has nothing to return to and we point it at the replacement instead.
  const restoreFocusTo = React.useRef<number | null>(null);
  // The row a mutation just changed has to be VISIBLE, not merely updated: it can sit
  // in week six, past the four weeks the feed renders up front, and a confirmation
  // nobody can see is not a confirmation. `reveal` opens the feed that far and marks
  // the row; the effect below scrolls to it on the commit that follows, by which time
  // it exists.
  const scrollToShift = React.useRef<number | null>(null);

  const filter = React.useMemo(() => ({ rota: rotaFilter, personId }), [rotaFilter, personId]);
  const weeks = React.useMemo(() => buildFeed(live, filter), [live, filter]);
  const upNext = React.useMemo(() => nextUp(live), [live]);
  const nextByMember = React.useMemo(() => nextShiftByMember(live), [live]);
  // Who the house calendar has away on the GROUP's today — the same reference date
  // every relative day on this page is measured from. Computed here rather than
  // inside the two lists that show it, so the strip and the card can never disagree.
  const awayToday = React.useMemo(
    () => awayMemberIdsOn(schedule.events, schedule.today),
    [schedule.events, schedule.today],
  );

  const filtered = rotaFilter.kind !== "everyone" || personId !== null;
  const visible = expanded ? weeks : weeks.slice(0, INITIAL_WEEKS);

  React.useEffect(() => {
    const shiftId = scrollToShift.current;
    if (shiftId === null) return;
    scrollToShift.current = null;
    scrollRowIntoView(shiftId);
  });

  /** Put the row for a just-changed shift on screen, expanding the feed if it is past
      the fourth week. Called after every cover that lands, in either direction. */
  function reveal(shift: MemberShift) {
    const start = weekStart(shift.due_on);
    if (weeks.findIndex((week) => week.weekStart === start) >= INITIAL_WEEKS) setExpanded(true);
    scrollToShift.current = shift.id;
  }

  function clearFilters() {
    setRotaFilter(ALL_SHIFTS.rota);
    setPersonId(null);
  }

  function openHandOff(shift: MemberShift) {
    restoreFocusTo.current = null;
    setHandingOff(shift);
    setSheetOpen(true);
  }

  function handedOff(updated: MemberShift) {
    applyUpdate(updated);
    restoreFocusTo.current = updated.id;
    reveal(updated);
  }

  /** Runs once the sheet has finished closing. True means we moved focus ourselves. */
  function focusAfterHandOff(): boolean {
    const shiftId = restoreFocusTo.current;
    restoreFocusTo.current = null;
    setHandingOff(null);
    if (shiftId === null) return false;

    // The row has already re-rendered from the server's authoritative shift, so this
    // finds the control that replaced the trigger rather than the trigger itself.
    const action = document.querySelector<HTMLElement>(`[data-shift-action="${shiftId}"]`);
    action?.focus();
    // Focusing scrolls the control into view on its own, but while the sheet was still
    // closing the page was scroll-locked, so the reveal effect could not move it. Now
    // the lock is gone, put the whole row on screen rather than just the button.
    scrollRowIntoView(shiftId);
    return action !== null;
  }

  async function takeBack(shift: MemberShift) {
    const result = await runAction(() => cancelAction(shift.id));
    if (!result.ok) {
      toastApiError(result.error, "Couldn't take it back just now. Try again.");
      // Re-throw so ConfirmDialog stays OPEN (its contract: a rejected onConfirm leaves
      // the dialog up to retry or cancel). Returning would close it right after the
      // error toast, stranding a network blip.
      throw new Error("cancel-cover-failed");
    }
    applyUpdate(result.shift);
    reveal(result.shift);
    setTakingBack(null);
    toast.success("Got it. You're back down for this one.");
  }

  const feed =
    weeks.length === 0 ? (
      filtered ? (
        <EmptyState
          icon={Filter}
          title="No shifts for this filter"
          description="Nothing matches that just now."
          action={
            <Button size="lg" onClick={clearFilters}>
              Show everyone
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={CalendarX}
          title="Nothing on the rota yet"
          description="Whoever runs your rota has not set anything up. We'll text you as soon as they do."
        />
      )
    ) : (
      <>
        <div className="space-y-8">
          {visible.map((week) => (
            <WeekSection
              key={week.weekStart}
              week={week}
              today={schedule.today}
              viewerId={schedule.member.id}
              onHandOff={openHandOff}
              onTakeBack={setTakingBack}
            />
          ))}
        </div>
        {!expanded && weeks.length > INITIAL_WEEKS ? (
          <Button variant="secondary" size="lg" className="w-full" onClick={() => setExpanded(true)}>
            Show more weeks
          </Button>
        ) : null}
      </>
    );

  return (
    <>
      <div className="lg:flex lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1 space-y-6">
          {/* Phone lead card. On desktop the same card is the sidebar's "You" card. */}
          <div className="lg:hidden">
            <NextShiftCard
              next={upNext}
              viewerId={schedule.member.id}
              today={schedule.today}
              onHandOff={openHandOff}
              onTakeBack={setTakingBack}
            />
          </div>

          <div className="lg:hidden">
            <PeopleStrip
              members={schedule.members}
              viewerId={schedule.member.id}
              awayToday={awayToday}
              selectedId={personId}
              onSelect={setPersonId}
            />
          </div>

          <FilterChips rotas={schedule.rotas} value={rotaFilter} onChange={setRotaFilter} />

          {feed}
        </div>

        <aside className="hidden w-[360px] shrink-0 space-y-4 lg:block">
          <NextShiftCard
            next={upNext}
            viewerId={schedule.member.id}
            today={schedule.today}
            onHandOff={openHandOff}
            onTakeBack={setTakingBack}
          />
          <PeopleCard
            members={schedule.members}
            viewerId={schedule.member.id}
            nextShifts={nextByMember}
            awayToday={awayToday}
            selectedId={personId}
            onSelect={setPersonId}
          />
        </aside>
      </div>

      <HandOffSheet
        shift={handingOff}
        schedule={live}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        assignAction={assignAction}
        onUpdated={handedOff}
        onCloseAutoFocus={focusAfterHandOff}
      />

      {takingBack && takingBack.covering_member ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => setTakingBack(open ? takingBack : null)}
          title="Take this shift back?"
          description={`${takingBack.covering_member.name} is covering ${takingBack.rota_name} on ${formatShiftDate(
            civilDate(takingBack.due_on),
          )} (${relativeDay(civilDate(takingBack.due_on), civilDate(schedule.today))}). Take it back and you're down for it again. We'll let ${takingBack.covering_member.name} know.`}
          confirmLabel="Take it back"
          onConfirm={() => takeBack(takingBack)}
        />
      ) : null}
    </>
  );
}

/** Bring a feed row onto the screen without yanking the page around it. */
function scrollRowIntoView(shiftId: number) {
  document.querySelector(`[data-shift-row="${shiftId}"]`)?.scrollIntoView({ block: "nearest" });
}
