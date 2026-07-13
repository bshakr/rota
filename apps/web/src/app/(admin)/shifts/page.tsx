import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Repeat } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getGroup, listMembers, listRotas, listShifts } from "@/lib/api/admin";
import type { MemberRef } from "@/lib/api/types";
import { compareCivil, groupToday, isFutureOrToday } from "@/lib/group-dates";

import { ShiftsBoard, type RotaShifts } from "./_components/shifts-board";

export const metadata: Metadata = { title: "Shifts" };

// Live, per-request, behind auth — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  const [{ group }, { rotas }, { members }] = await Promise.all([
    getGroup(),
    listRotas(),
    listMembers(),
  ]);

  const today = groupToday(new Date(), group.timezone);

  const runningRotas = rotas.filter((rota) => rota.active && !rota.draft);
  const withShifts = await Promise.all(
    runningRotas.map((rota) => listShifts(rota.id).then(({ shifts }) => ({ rota, shifts }))),
  );

  // Only future shifts can be overridden, so those are the only ones worth showing.
  const board: RotaShifts[] = withShifts
    .map(({ rota, shifts }) => ({
      id: rota.id,
      name: rota.name,
      shifts: shifts
        .filter((shift) => isFutureOrToday(shift.due_on, today))
        .sort((a, b) => compareCivil(a.due_on, b.due_on)),
    }))
    .filter((rota) => rota.shifts.length > 0);

  // Active members are the only ones the API will accept as a cover.
  const coverableMembers: MemberRef[] = members
    .filter((member) => member.active)
    .map((member) => ({ id: member.id, name: member.name }));

  return (
    <>
      <PageHeader
        title="Upcoming shifts"
        description="Every turn coming up, covers included. Override any of them."
      />

      {rotas.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No rotas yet"
          description="Shifts come from rotas. Create your first rota and its turns show up here."
          action={
            <Button asChild>
              <Link href="/rotas">Create your first rota</Link>
            </Button>
          }
        />
      ) : board.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No upcoming shifts"
          description="Nothing is scheduled ahead right now. New turns appear as each rota rolls forward."
        />
      ) : (
        <ShiftsBoard rotas={board} members={coverableMembers} today={today} />
      )}
    </>
  );
}
