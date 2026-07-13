"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastApiError } from "@/lib/api/toast";
import type { IntervalUnit, Member, RotaPositionEntry, Shift } from "@/lib/api/types";
import { initials } from "@/lib/format";

import { updateRotaPositionsAction } from "../actions";
import { ShiftProjection } from "./shift-projection";
import { UpcomingShifts } from "./upcoming-shifts";

// The roster editor. The order IS the rotation, so reordering has to be first
// class: native drag on a pointer device (the grip handle), and Up/Down buttons
// that work with touch and the keyboard, since HTML5 drag does neither.
//
// Crucially, this is the operation that does NOT warn: replacing the roster
// regenerates future shifts but PRESERVES covers, the opposite of a schedule
// change. Saving says so, so the two never feel arbitrary.
export function RosterEditor({
  rotaId,
  initialRoster,
  allMembers,
  savedShifts,
  startsOn,
  intervalCount,
  intervalUnit,
  todayDay,
}: {
  rotaId: number;
  initialRoster: RotaPositionEntry[];
  allMembers: Member[];
  /** The real, Rails-generated shifts (authoritative once the roster is saved). */
  savedShifts: Shift[];
  startsOn: string;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  todayDay: string;
}) {
  const router = useRouter();
  const [order, setOrder] = React.useState<RotaPositionEntry[]>(initialRoster);
  const [saving, setSaving] = React.useState(false);
  const dragFrom = React.useRef<number | null>(null);

  // Re-sync when the server hands down a new roster (after a save + refresh),
  // using React's "reset state on prop change during render" pattern rather than
  // an effect — no cascading render, and local edits survive unrelated re-renders.
  const initialSignature = initialRoster.map((m) => m.member_id).join(",");
  const [syncedSignature, setSyncedSignature] = React.useState(initialSignature);
  if (initialSignature !== syncedSignature) {
    setSyncedSignature(initialSignature);
    setOrder(initialRoster);
  }

  const currentSignature = order.map((m) => m.member_id).join(",");
  const dirty = currentSignature !== initialSignature;

  const available = allMembers.filter(
    (m) => m.active && !order.some((o) => o.member_id === m.id),
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function add(memberId: number) {
    const member = allMembers.find((m) => m.id === memberId);
    if (!member || order.some((o) => o.member_id === memberId)) return;
    setOrder((prev) => [
      ...prev,
      { member_id: member.id, name: member.name, position: prev.length },
    ]);
  }

  function remove(memberId: number) {
    setOrder((prev) => prev.filter((o) => o.member_id !== memberId));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await updateRotaPositionsAction(
        rotaId,
        order.map((o) => o.member_id),
      );
      if (result.ok) {
        toast.success("Roster saved.", {
          description: "Future shifts regenerated. Agreed covers were kept.",
        });
        router.refresh();
      } else {
        toastApiError(result.error, "Couldn't save the roster.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-56">
          <Select
            value=""
            onValueChange={(value) => add(Number(value))}
            disabled={available.length === 0}
          >
            <SelectTrigger className="w-full" aria-label="Add a member to the roster">
              <span className="flex items-center gap-2">
                <UserPlus className="size-4" aria-hidden />
                <SelectValue
                  placeholder={available.length === 0 ? "Everyone is on" : "Add member"}
                />
              </span>
            </SelectTrigger>
            <SelectContent>
              {available.map((member) => (
                <SelectItem key={member.id} value={String(member.id)}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {dirty ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setOrder(initialRoster)} disabled={saving}>
              Reset
            </Button>
            <Button onClick={save} loading={saving}>
              Save roster
            </Button>
          </div>
        ) : null}
      </div>

      {order.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No one is on this rota yet. Add members above to take it out of draft.
        </p>
      ) : (
        <ul className="space-y-2">
          {order.map((entry, index) => (
            <li
              key={entry.member_id}
              draggable
              onDragStart={() => {
                dragFrom.current = index;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null && dragFrom.current !== index) {
                  move(dragFrom.current, index);
                  dragFrom.current = index;
                }
              }}
              onDragEnd={() => {
                dragFrom.current = null;
              }}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5"
            >
              <span
                className="cursor-grab text-muted-foreground active:cursor-grabbing"
                aria-hidden
              >
                <GripVertical className="size-4" />
              </span>
              <span className="w-5 shrink-0 text-center text-sm tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{initials(entry.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${entry.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${entry.name} down`}
                  disabled={index === order.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${entry.name} from the roster`}
                  onClick={() => remove(entry.member_id)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t border-border pt-5">
        <p className="text-sm font-medium">Upcoming shifts</p>
        {/* While the order is unsaved, show the transient client projection — a
            "who'd land where" hint. The moment it's saved, Rails is authoritative,
            so we show the real generated shifts (which also reflect any covers). */}
        {dirty ? (
          <>
            <ShiftProjection
              startsOn={startsOn}
              intervalCount={intervalCount}
              intervalUnit={intervalUnit}
              roster={order}
              todayDay={todayDay}
            />
            <p className="text-xs text-muted-foreground">
              Previewing your unsaved order. Save the roster to apply it and see the
              scheduled shifts.
            </p>
          </>
        ) : (
          <UpcomingShifts shifts={savedShifts} todayDay={todayDay} />
        )}
      </div>
    </div>
  );
}
