import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getRota, listMembers, listShifts } from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";

import { RotaEditor } from "../_components/rota-editor";
import { scheduleLabel, todayDayString } from "../rota-logic";

export const metadata: Metadata = { title: "Edit rota" };

export default async function EditRotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rotaId = Number(id);
  if (!Number.isInteger(rotaId)) notFound();

  let rota;
  let members;
  let shifts;
  try {
    const [rotaResponse, membersResponse, shiftsResponse] = await Promise.all([
      getRota(rotaId),
      listMembers(),
      listShifts(rotaId),
    ]);
    rota = rotaResponse.rota;
    members = membersResponse.members;
    shifts = shiftsResponse.shifts;
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={rota.name}
        description={`${scheduleLabel(rota.interval_count, rota.interval_unit)} · ${rota.positions.length} on the roster`}
        actions={
          <Button asChild variant="outline">
            <Link href="/rotas">All rotas</Link>
          </Button>
        }
      />
      <RotaEditor rota={rota} members={members} shifts={shifts} todayDay={todayDayString()} />
    </>
  );
}
