"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import type { CoverCandidate } from "@/app/(member)/s/[token]/cover-ranking";
import { rankCoverCandidates } from "@/app/(member)/s/[token]/cover-ranking";
import type { AssignAction } from "@/app/(member)/s/[token]/use-shift-updates";
import { runAction } from "@/app/(member)/s/[token]/use-shift-updates";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { toastApiError } from "@/lib/api/toast";
import type { MemberScheduleResponse, MemberShift } from "@/lib/api/types";
import { avatarTint } from "@/lib/avatar-tint";
import { formatLongDate, formatShiftDate, relativeDay } from "@/lib/date";
import { initials } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";

// Handing a shift on, on both viewports. A bottom SHEET on a phone (a thumb reaches
// the bottom of a 390px screen, not the middle of it) and a centred DIALOG on a
// desktop. The contents are identical, which is why they are one component: two
// copies would drift, and this is the screen where a wrong name gets somebody texted.
//
// The candidates are ranked rather than listed, because a flat list of names makes
// every housemate look equally free. See cover-ranking.ts for the rules.

const GROUP_LABELS = {
  free: "Free that week",
  busy: "Has a shift that week",
  unavailable: "Can't be texted",
} as const;

export function HandOffSheet({
  shift,
  schedule,
  open,
  onOpenChange,
  assignAction,
  onUpdated,
}: {
  /** The shift being handed off, or null when the sheet is closed. */
  shift: MemberShift | null;
  schedule: MemberScheduleResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignAction: AssignAction;
  onUpdated: (shift: MemberShift) => void;
}) {
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState(false);

  // Nothing is preselected, EVER: this action texts a real person, so it must be a
  // deliberate choice and not whatever happened to be first.
  //
  // The reset is an adjustment made DURING render rather than in an effect (React's
  // "you might not need an effect"; an effect here also trips
  // react-hooks/set-state-in-effect). Every open and every close forgets the previous
  // choice, including reopening the same row, and it lands before the paint rather
  // than one render later, so a stale name can never flash in the primary button.
  const [openedFor, setOpenedFor] = React.useState<number | null>(null);
  const session = open && shift ? shift.id : null;
  if (openedFor !== session) {
    setOpenedFor(session);
    setSelectedId(null);
  }

  if (!shift) return null;

  const ranked = rankCoverCandidates(shift, schedule);
  const selectable = [...ranked.free, ...ranked.busy];
  const selected = selectable.find((candidate) => candidate.member.id === selectedId) ?? null;
  const date = civilDate(shift.due_on);
  const when = relativeDay(date, civilDate(schedule.today));
  const nobody = ranked.free.length + ranked.busy.length + ranked.unavailable.length === 0;

  function change(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  async function confirm() {
    // Re-entry guard: this POST texts the person picked, so a double tap must not fire
    // it twice. The button is disabled while pending too, but guard here in case two
    // taps queue before the disable commits.
    if (!shift || !selected || pending) return;
    setPending(true);
    const result = await runAction(() => assignAction(shift.id, selected.member.id));
    setPending(false);

    if (!result.ok) {
      // A human sentence, never a code. Stay open so they can pick someone else, e.g.
      // if that person just opted out.
      toastApiError(result.error, "Couldn't send that just now. Try again.");
      return;
    }
    onUpdated(result.shift);
    toast.success(`${selected.member.name} is covering. We'll text them to let them know.`);
    onOpenChange(false);
  }

  const title = `Hand off ${shift.rota_name}`;
  const subtitle = `${formatLongDate(date)} · ${when}`;

  const body = nobody ? (
    <p className="text-muted-foreground px-5 text-sm text-pretty">
      No one else can cover yet. Whoever runs your rota can add more people to the house.
    </p>
  ) : (
    <div
      role="radiogroup"
      aria-label="Who to hand it to"
      // A big house makes a long list and this opens on a phone: cap the height and
      // let the names scroll rather than pushing the footer off the screen.
      className="max-h-[50vh] space-y-4 overflow-y-auto px-5"
    >
      {(["free", "busy", "unavailable"] as const).map((group) =>
        ranked[group].length === 0 ? null : (
          <div key={group} className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {GROUP_LABELS[group]}
            </p>
            <ul className="space-y-1.5">
              {ranked[group].map((candidate) => (
                <CandidateRow
                  key={candidate.member.id}
                  candidate={candidate}
                  selectable={group !== "unavailable"}
                  selected={selectedId === candidate.member.id}
                  disabled={pending}
                  onSelect={() => setSelectedId(candidate.member.id)}
                />
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );

  // What actually happens, in the API's own terms: MemberCoversController records a
  // cover_notice for whoever's turn changed (everyone but the caller) and enqueues it
  // on commit, and ReminderSweep resolves the recipient as Shift#responsible_member at
  // SEND time, so every remaining reminder for this shift follows the cover.
  const footnote = (
    <p className="text-muted-foreground px-5 pb-1 text-xs text-pretty">
      We text them straight away, and every reminder left for this shift goes to them instead of you.
    </p>
  );

  const actions = (
    <>
      <Button variant="secondary" size="lg" onClick={() => change(false)} disabled={pending}>
        Cancel
      </Button>
      {nobody ? null : (
        // `disabled={!selected || pending}`, NOT `loading` alone: Button derives its
        // disabled state as `disabled ?? loading`, so an explicit `disabled={false}`
        // would shortcut it and a double tap would text twice.
        <Button size="lg" onClick={confirm} disabled={!selected || pending} loading={pending}>
          {selected ? `Hand off to ${selected.member.name}` : "Hand off"}
        </Button>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="gap-4 px-0">
          <DialogHeader className="px-5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>
          {body}
          {nobody ? null : footnote}
          <DialogFooter className="px-5">{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent side="bottom" className="max-h-[90vh] gap-4 pb-6">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>
        {body}
        {nobody ? null : footnote}
        <SheetFooter>{actions}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** One name, with the reason it is in the group it is in. */
function CandidateRow({
  candidate,
  selectable,
  selected,
  disabled,
  onSelect,
}: {
  candidate: CoverCandidate;
  selectable: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { member, weekShifts } = candidate;
  const detail = selectable
    ? weekShifts
        .map((shift) => `${shift.rota_name} · ${formatShiftDate(civilDate(shift.due_on))}`)
        .join(", ")
    : "Not receiving texts right now";

  const content = (
    <>
      <Avatar size="sm">
        <AvatarFallback className={cn(avatarTint(member.name), "text-foreground text-[10px]")}>
          {initials(member.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{member.name}</span>
        {detail ? (
          <span className="text-muted-foreground block truncate text-xs">{detail}</span>
        ) : null}
      </span>
      {selected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
    </>
  );

  if (!selectable) {
    return (
      <li className="flex items-center gap-3 rounded-2xl px-3 py-2.5 opacity-60">{content}</li>
    );
  }

  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "focus-visible:outline-ring flex min-h-11 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60",
          selected ? "border-primary bg-lemon/25" : "border-border hover:bg-accent",
        )}
      >
        {content}
      </button>
    </li>
  );
}
