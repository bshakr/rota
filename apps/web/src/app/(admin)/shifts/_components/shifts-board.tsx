"use client";

import * as React from "react";
import { ArrowRightLeft, Loader2Icon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toastApiError } from "@/lib/api/toast";
import type { MemberRef, Shift } from "@/lib/api/types";
import { formatShiftDate, relativeDay } from "@/lib/date";
import { initials } from "@/lib/format";
import { civilDate } from "@/lib/group-dates";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { setShiftCover } from "../actions";

/** One rota with its upcoming shifts, already filtered to the future and sorted. */
export interface RotaShifts {
  id: number;
  name: string;
  shifts: Shift[];
}

// "No cover" needs a real value — Radix Select rejects an empty string.
const NONE = "none";

// Human copy for the override's rejections, used only when the API doesn't send
// its own message. The guards fire on a shift that ticked into the past while the
// page was open, or a member deactivated in another tab.
const GUARD_MESSAGES: Record<string, string> = {
  shift_in_the_past: "That shift is in the past now — its cover can't be changed.",
  member_inactive: "That person has been deactivated, so they can't cover a shift.",
  member_not_found: "That person is no longer in the group.",
};

/**
 * The upcoming-shifts board with the admin override. A covered turn is set apart
 * at a glance — a tinted row and an info badge — before any text is read. Setting
 * or clearing a cover goes through the `setShiftCover` server action and updates
 * the row in place, so the change is visible immediately without a reload.
 */
export function ShiftsBoard({
  rotas,
  members,
  today,
}: {
  rotas: RotaShifts[];
  members: MemberRef[];
  today: string;
}) {
  const todayDate = civilDate(today);
  const [byId, setById] = React.useState<Record<number, Shift>>(() =>
    Object.fromEntries(rotas.flatMap((rota) => rota.shifts).map((shift) => [shift.id, shift])),
  );
  const [pendingId, setPendingId] = React.useState<number | null>(null);

  async function handleCover(shift: Shift, value: string) {
    const next = value === NONE ? null : Number(value);
    const current = shift.covering_member?.id ?? null;
    if (next === current) return;

    setPendingId(shift.id);
    const result = await setShiftCover(shift.id, next);
    setPendingId(null);

    if (!result.ok) {
      toastApiError(result.error, GUARD_MESSAGES[result.error.error]);
      return;
    }
    setById((prev) => ({ ...prev, [shift.id]: result.shift }));
    toast.success(
      result.shift.covered
        ? `${result.shift.covering_member?.name} is now covering.`
        : "Cover cleared.",
    );
  }

  // Who the admin can hand a shift to: active members, minus the person already
  // assigned (covering yourself is a no-op), keeping the current cover visible.
  function coverOptions(shift: Shift): MemberRef[] {
    const options = members.filter((member) => member.id !== shift.assigned_member.id);
    const cover = shift.covering_member;
    if (cover && !options.some((member) => member.id === cover.id)) {
      return [cover, ...options];
    }
    return options;
  }

  return (
    <div className="space-y-10">
      {rotas.map((rota) => (
        <section key={rota.id}>
          <h2 className="mb-3 font-heading text-lg font-medium">{rota.name}</h2>

          {/* md+ : a table */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Up</TableHead>
                  <TableHead>Cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rota.shifts.map(({ id }) => {
                  const shift = byId[id];
                  return (
                    <TableRow key={id} className={cn(shift.covered && "bg-info/5")}>
                      <TableCell className="align-top font-medium tabular-nums">
                        <div>{formatShiftDate(civilDate(shift.due_on))}</div>
                        <div className="text-xs font-normal text-muted-foreground">
                          {capitalise(relativeDay(civilDate(shift.due_on), todayDate))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ResponsibleCell shift={shift} />
                      </TableCell>
                      <TableCell>
                        <CoverControl
                          shift={shift}
                          options={coverOptions(shift)}
                          pending={pendingId === shift.id}
                          onChange={(value) => handleCover(shift, value)}
                          label={coverLabel(rota.name, shift)}
                          className="w-44"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* below md : a stack of cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {rota.shifts.map(({ id }) => {
              const shift = byId[id];
              return (
                <Card key={id} size="sm" className={cn(shift.covered && "bg-info/5")}>
                  <CardHeader>
                    <CardTitle className="text-sm tabular-nums">
                      {formatShiftDate(civilDate(shift.due_on))}
                    </CardTitle>
                    <CardDescription>
                      {capitalise(relativeDay(civilDate(shift.due_on), todayDate))}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ResponsibleCell shift={shift} />
                    <CoverControl
                      shift={shift}
                      options={coverOptions(shift)}
                      pending={pendingId === shift.id}
                      onChange={(value) => handleCover(shift, value)}
                      label={coverLabel(rota.name, shift)}
                      className="w-full"
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Who is actually on the hook — the covering member when covered, else the assignee. */
function ResponsibleCell({ shift }: { shift: Shift }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Avatar size="sm">
        <AvatarFallback>{initials(shift.responsible_member.name)}</AvatarFallback>
      </Avatar>
      <span className="font-medium">{shift.responsible_member.name}</span>
      {shift.covered ? (
        <Badge variant="info">
          <ArrowRightLeft aria-hidden />
          covering {shift.assigned_member.name}
        </Badge>
      ) : null}
    </span>
  );
}

function CoverControl({
  shift,
  options,
  pending,
  onChange,
  label,
  className,
}: {
  shift: Shift;
  options: MemberRef[];
  pending: boolean;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select
      value={shift.covering_member ? String(shift.covering_member.id) : NONE}
      onValueChange={onChange}
      disabled={pending}
    >
      <SelectTrigger size="sm" aria-label={label} className={className}>
        {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No cover</SelectItem>
        {options.map((member) => (
          <SelectItem key={member.id} value={String(member.id)}>
            {member.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const coverLabel = (rotaName: string, shift: Shift) =>
  `Cover for ${rotaName} on ${formatShiftDate(civilDate(shift.due_on))}`;
