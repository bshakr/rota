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
import { formatShiftDate, relativeDay } from "@/lib/date";
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

const GROUPS = ["free", "busy", "unavailable"] as const;

type CandidateGroup = (typeof GROUPS)[number];

const GROUP_LABELS: Record<CandidateGroup, string> = {
  free: "Free that week",
  busy: "Has a shift that week",
  unavailable: "Can't be texted",
};

export function HandOffSheet({
  shift,
  schedule,
  open,
  onOpenChange,
  assignAction,
  onUpdated,
  onCloseAutoFocus,
}: {
  /** The shift being handed off. Held through the close animation, then cleared. */
  shift: MemberShift | null;
  schedule: MemberScheduleResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignAction: AssignAction;
  onUpdated: (shift: MemberShift) => void;
  /**
   * Fired once the sheet has finished closing. Return true if you moved focus
   * yourself, and Radix's own restore is suppressed — which it must be after a
   * successful hand-off, because the "Hand off" button that opened this sheet has
   * been replaced by a "Take it back" and restoring to it drops focus on <body>.
   */
  onCloseAutoFocus?: () => boolean;
}) {
  const isDesktop = useIsDesktop();
  const uid = React.useId();
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

  // Ranking walks every upcoming shift in the house, so it must not re-run on each
  // keystroke of the selection. Keyed on the two identities it reads: the shift being
  // handed off, and the schedule (which member-feed re-creates whenever a cover lands,
  // so a stale ranking cannot survive a mutation).
  const ranked = React.useMemo(
    () => (shift ? rankCoverCandidates(shift, schedule) : null),
    [shift, schedule],
  );

  if (!shift || !ranked) return null;

  const selectable = [...ranked.free, ...ranked.busy];
  const selected = selectable.find((candidate) => candidate.member.id === selectedId) ?? null;
  const date = civilDate(shift.due_on);
  const when = relativeDay(date, civilDate(schedule.today));
  const nobody = ranked.free.length + ranked.busy.length + ranked.unavailable.length === 0;

  function change(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function handleCloseAutoFocus(event: Event) {
    if (onCloseAutoFocus?.()) event.preventDefault();
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
  // "Sat 14 Nov · in 3 days", per the spec: the weekday and the relative day are the
  // two things that decide whether handing off is even the right call.
  const subtitle = `${formatShiftDate(date)} · ${when}`;

  const body = nobody ? (
    <p className="text-muted-foreground px-5 text-sm text-pretty">
      No one else can cover yet. Whoever runs your rota can add more people to the house.
    </p>
  ) : (
    // A real <fieldset> of real radios sharing one name, not a div wearing
    // role="radiogroup". That is what gets arrow keys, Home/End and "3 of 5" out of
    // iOS VoiceOver for free; the hand-rolled version announced nothing of the sort.
    // The group headings ("Free that week") are plain text the radios point at with
    // aria-describedby, because a nested fieldset per group would split the arrow-key
    // ring the ordering depends on. min-w-0 undoes the UA's min-inline-size:min-content
    // on fieldset, which would otherwise stop long names truncating.
    <fieldset className="flex max-h-[50vh] min-w-0 flex-col gap-4 overflow-y-auto px-5">
      <legend className="sr-only">Who to hand it to</legend>
      {GROUPS.map((group) =>
        ranked[group].length === 0 ? null : (
          <div key={group} className="space-y-1.5">
            <p
              id={`${uid}-${group}`}
              className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
            >
              {GROUP_LABELS[group]}
            </p>
            <ul className="space-y-1.5">
              {ranked[group].map((candidate) => (
                <CandidateRow
                  key={candidate.member.id}
                  candidate={candidate}
                  name={`${uid}-candidate`}
                  describedBy={`${uid}-${group}`}
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
    </fieldset>
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
        <DialogContent className="gap-4 px-0" onCloseAutoFocus={handleCloseAutoFocus}>
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
      <SheetContent
        side="bottom"
        className="max-h-[90vh] gap-4 pb-6"
        onCloseAutoFocus={handleCloseAutoFocus}
      >
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
  name,
  describedBy,
  selectable,
  selected,
  disabled,
  onSelect,
}: {
  candidate: CoverCandidate;
  /** The shared radio name: one name is one arrow-key ring. */
  name: string;
  /** The id of the group heading this candidate sits under. */
  describedBy: string;
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
      {/* The <label> is the hit target, so the whole 44px row is tappable and the
          radio itself can be screen-reader-only. The ring is drawn from the input's
          :focus-visible so a mouse click does not light it up. */}
      <label
        className={cn(
          "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
          "has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
          "has-[:disabled]:cursor-default has-[:disabled]:opacity-60",
          selected ? "border-primary bg-lemon/25" : "border-border hover:bg-accent",
        )}
      >
        <input
          type="radio"
          name={name}
          className="sr-only"
          checked={selected}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={onSelect}
        />
        {content}
      </label>
    </li>
  );
}
