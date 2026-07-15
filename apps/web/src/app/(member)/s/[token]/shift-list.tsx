"use client";

import * as React from "react";
import { CalendarCheck, Circle, CircleCheck } from "lucide-react";
import { toast } from "sonner";

import { ShiftCard } from "@/components/member/shift-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toastApiError } from "@/lib/api/toast";
import type { MemberRef, MemberShift } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";

import type { CoverActionResult } from "./action-result";
import { coverTargetsFor, shiftStateFor } from "./shift-view";

// The interactive half of the member page: the list of upcoming shifts and the
// one thing a member came to do — arrange cover, or take it back.
//
// It is a Client Component because the flow is a dialog and a running button, but
// it never sees the magic-link token: the two mutations arrive already bound to
// the token (server-side, in page.tsx), so this component supplies only the shift
// and member ids. Each successful mutation returns the updated shift — resolved
// for this member — and the card re-renders from it; a shift that stops involving
// this member (they handed on a turn they were only covering) drops off the list,
// exactly as a reload would show it.

type AssignAction = (shiftId: number, coveringMemberId: number) => Promise<CoverActionResult>;
type CancelAction = (shiftId: number) => Promise<CoverActionResult>;

export function ShiftList({
  initialShifts,
  coverableMembers,
  memberId,
  today,
  assignAction,
  cancelAction,
}: {
  initialShifts: MemberShift[];
  coverableMembers: MemberRef[];
  memberId: number;
  /** The group's today as a civil date (YYYY-MM-DD); the reference for "in 3 days". */
  today: string;
  assignAction: AssignAction;
  cancelAction: CancelAction;
}) {
  const [shifts, setShifts] = React.useState(initialShifts);
  const todayDate = React.useMemo(() => civilDate(today), [today]);

  // Replace the mutated shift with the server's authoritative version, and drop it
  // if it no longer concerns this member (handed on a shift they were covering).
  const applyUpdate = React.useCallback(
    (updated: MemberShift) => {
      setShifts((prev) =>
        prev
          .map((shift) => (shift.id === updated.id ? updated : shift))
          .filter((shift) => shiftStateFor(shift, memberId) !== null),
      );
    },
    [memberId],
  );

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="You're all clear"
        description="Nothing coming up for you right now. We'll text you when your next turn is near."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {shifts.map((shift) => {
        const state = shiftStateFor(shift, memberId);
        if (!state) return null;
        return (
          <li key={shift.id}>
            <ShiftCard
              rota={shift.rota_name}
              date={civilDate(shift.due_on)}
              today={todayDate}
              state={state}
              action={
                <CoverActions
                  shift={shift}
                  targets={coverTargetsFor(shift, coverableMembers)}
                  today={today}
                  onUpdate={applyUpdate}
                  assignAction={assignAction}
                  cancelAction={cancelAction}
                />
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

// can_assign_cover and can_cancel_cover are resolved server-side and are mutually
// exclusive: you can hand on a shift you're responsible for, or take back one you
// gave away, never both at once. A shift too soon to touch (today's turn) shows
// neither — there is nothing to do but show up.
function CoverActions({
  shift,
  targets,
  today,
  onUpdate,
  assignAction,
  cancelAction,
}: {
  shift: MemberShift;
  targets: MemberRef[];
  today: string;
  onUpdate: (shift: MemberShift) => void;
  assignAction: AssignAction;
  cancelAction: CancelAction;
}) {
  if (shift.can_assign_cover) {
    // Within this branch the member is whoever is responsible; if the shift is
    // already covered, that's them (they took someone else's turn and are now
    // passing it on), otherwise it's their own turn.
    //
    // The cover CTA is the escape hatch, not the point of the page — the point
    // is knowing when you're up. So it's an OUTLINE button (the styleguide's
    // member idiom), and the question lives in the label: seven cards with
    // seven solid clay buttons read as seven alarms.
    const iAmCovering = shift.covered;
    return (
      <AskCoverDialog
        shift={shift}
        targets={targets}
        today={today}
        label={
          iAmCovering
            ? "Can't make it after all? Ask someone else"
            : "Can't make it? Ask someone to cover"
        }
        onUpdate={onUpdate}
        assignAction={assignAction}
      />
    );
  }

  if (shift.can_cancel_cover && shift.covering_member) {
    const coveringName = shift.covering_member.name;
    const when = relativeDay(civilDate(shift.due_on), civilDate(today));
    return (
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="lg" className="w-full">
            I can make it after all
          </Button>
        }
        title="Take this shift back?"
        description={`${coveringName} is covering ${shift.rota_name} on ${formatShiftDate(
          civilDate(shift.due_on),
        )} (${when}). Take it back and you're down for it again — we'll let ${coveringName} know.`}
        confirmLabel="Take it back"
        onConfirm={async () => {
          const result = await runCancel(cancelAction, shift.id);
          if (!result.ok) {
            toastApiError(result.error, "Couldn't take it back just now. Try again.");
            // Re-throw so ConfirmDialog stays OPEN (its contract: a rejected
            // onConfirm leaves the dialog up to retry or cancel). Returning would
            // close it right after the error toast, stranding a network blip.
            throw new Error("cancel-cover-failed");
          }
          onUpdate(result.shift);
          toast.success("Got it — you're back down for this one.");
        }}
      />
    );
  }

  return null;
}

function AskCoverDialog({
  shift,
  targets,
  today,
  label,
  onUpdate,
  assignAction,
}: {
  shift: MemberShift;
  targets: MemberRef[];
  today: string;
  label: string;
  onUpdate: (shift: MemberShift) => void;
  assignAction: AssignAction;
}) {
  const [open, setOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState(false);

  const selected = targets.find((member) => member.id === selectedId) ?? null;
  const when = relativeDay(civilDate(shift.due_on), civilDate(today));

  function change(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) setSelectedId(null);
  }

  async function confirm() {
    // Re-entry guard: this POST texts the person picked, so a double-tap must not
    // fire it twice. The button is also disabled while pending, but guard here too
    // in case two taps queue before the disable commits.
    if (!selected || pending) return;
    setPending(true);
    let result: CoverActionResult;
    try {
      result = await assignAction(shift.id, selected.id);
    } catch (error) {
      setPending(false);
      toastApiError(error, "Couldn't send that just now. Try again.");
      return;
    }
    setPending(false);

    if (!result.ok) {
      // A human sentence, never a code — the API sends one per rejection. Stay open
      // so they can pick someone else (e.g. that person just opted out).
      toastApiError(result.error);
      return;
    }
    onUpdate(result.shift);
    toast.success(`${selected.name} is covering. We'll text them to let them know.`);
    setOpen(false);
    setSelectedId(null);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline" className="w-full">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask someone to cover</DialogTitle>
          <DialogDescription>
            {shift.rota_name} · {formatShiftDate(civilDate(shift.due_on))} ({when}). Pick who to
            ask — we&apos;ll text them.
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There&apos;s no one else free to ask right now. Whoever runs your rota can help.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Who to ask" className="grid gap-2">
            {targets.map((member) => {
              const active = selectedId === member.id;
              const Icon = active ? CircleCheck : Circle;
              return (
                <Button
                  key={member.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  variant={active ? "default" : "outline"}
                  size="lg"
                  className="w-full justify-start"
                  disabled={pending}
                  onClick={() => setSelectedId(member.id)}
                >
                  <Icon aria-hidden />
                  {member.name}
                </Button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => change(false)} disabled={pending}>
            Cancel
          </Button>
          {/* `disabled={!selected || pending}`, NOT `loading` alone: Button derives
              its disabled state as `disabled ?? loading`, and an explicit
              `disabled={false}` (a target IS selected) shortcuts that — so `loading`
              would never block the click and a double-tap would text twice. */}
          <Button onClick={confirm} disabled={!selected || pending} loading={pending}>
            {selected ? `Ask ${selected.name}` : "Ask them to cover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The action can THROW only for a genuinely unreachable API; an ApiError comes back
// as a value. Normalise a throw into the same shape so the one caller handles both.
async function runCancel(cancel: CancelAction, shiftId: number): Promise<CoverActionResult> {
  try {
    return await cancel(shiftId);
  } catch {
    return { ok: false, error: { error: "request_failed" } };
  }
}
