"use client";

import * as React from "react";

import { toastApiError } from "@/lib/api/toast";
import type { MemberRemovalResponse } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatLongDate } from "@/lib/date";

import { removeMemberAction } from "./actions";
import type { MemberRow } from "./data";

// Removing a member is deactivation, never a hard delete — but the point of this
// dialog is that it is never a SILENT reshuffle. The confirm step says what will
// happen in general; the DELETE response says what actually did, resolved to
// names, and the second step enumerates it: who inherited each turn, and which
// covers were handed back. The admin sees the consequence, not just the button.

/** A date-only "YYYY-MM-DD" from the API, rendered in the group's zone. UTC-parsed so the day never slips. */
function formatDay(due_on: string): string {
  return formatLongDate(new Date(due_on));
}

function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function RotaList({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

function OutcomeRow({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="border-border bg-muted/40 flex flex-col gap-0.5 rounded-lg border p-3">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground">{detail}</span>
    </li>
  );
}

export function RemoveMemberDialog({
  member,
  onClose,
}: {
  member: MemberRow;
  onClose: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [outcome, setOutcome] = React.useState<MemberRemovalResponse | null>(null);

  async function confirmRemoval() {
    setPending(true);
    try {
      const result = await removeMemberAction(member.id);
      if (result.ok) {
        setOutcome(result.data);
      } else {
        toastApiError(result.error, `Couldn't remove ${member.name}.`);
      }
    } finally {
      setPending(false);
    }
  }

  const done = outcome !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Never yank the dialog out from under an in-flight removal.
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent showCloseButton={done}>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{member.name} removed</DialogTitle>
              <DialogDescription>Here is exactly what moved.</DialogDescription>
            </DialogHeader>

            <div className="flex max-h-[50vh] flex-col gap-5 overflow-y-auto text-sm">
              {outcome.reassigned_shifts.length > 0 && (
                <section>
                  <h3 className="mb-2 font-medium">
                    {countLabel(outcome.reassigned_shifts.length, "future turn reassigned", "future turns reassigned")}
                  </h3>
                  <RotaList>
                    {outcome.reassigned_shifts.map((shift) => (
                      <OutcomeRow
                        key={`${shift.rota_id}-${shift.due_on}`}
                        title={shift.rota_name}
                        detail={`${formatDay(shift.due_on)} · now ${
                          shift.now_assigned_member_name ?? "no one — the rota has no members left"
                        }`}
                      />
                    ))}
                  </RotaList>
                </section>
              )}

              {outcome.dropped_covers.length > 0 && (
                <section>
                  <h3 className="mb-2 font-medium">
                    {countLabel(outcome.dropped_covers.length, "cover released", "covers released")}
                  </h3>
                  <RotaList>
                    {outcome.dropped_covers.map((cover) => (
                      <OutcomeRow
                        key={cover.shift_id}
                        title={cover.rota_name}
                        detail={`${formatDay(cover.due_on)} · back to ${cover.reverts_to_member_name}`}
                      />
                    ))}
                  </RotaList>
                </section>
              )}

              {outcome.reassigned_shifts.length === 0 && outcome.dropped_covers.length === 0 && (
                <p className="text-muted-foreground">
                  No future turns or covers were affected — nothing else changed.
                </p>
              )}
            </div>

            <DialogFooter className="mt-2">
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Remove {member.name} from the house?</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Any future turns {member.name} was due to take pass to the next person in each
                    rota&apos;s order, and any shifts they&apos;d agreed to cover go back to whoever
                    they were covering for.
                  </p>
                  {member.rotaNames.length > 0 && (
                    <p>
                      They&apos;re currently on{" "}
                      <span className="text-foreground font-medium">{member.rotaNames.join(", ")}</span>.
                    </p>
                  )}
                  <p>This can&apos;t be undone — there is no reactivating a member.</p>
                </div>
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" loading={pending} onClick={confirmRemoval}>
                Remove {member.name}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
