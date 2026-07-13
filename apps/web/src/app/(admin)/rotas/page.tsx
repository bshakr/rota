import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Repeat } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listRotas } from "@/lib/api/admin";
import type { Rota } from "@/lib/api/types";
import { formatShiftDate } from "@/lib/date";

import { DeactivateRotaButton } from "./_components/deactivate-rota-button";
import {
  dayStringToDisplayDate,
  projectShifts,
  scheduleLabel,
  sendHourLabel,
  todayDayString,
} from "./rota-logic";

export const metadata: Metadata = { title: "Rotas" };

export default async function RotasPage() {
  const { rotas } = await listRotas();
  const today = todayDayString();

  return (
    <>
      <PageHeader
        title="Rotas"
        description="A named job, a schedule, and an ordered list of people taking turns."
        actions={
          <Button asChild>
            <Link href="/rotas/new">
              <Plus /> New rota
            </Link>
          </Button>
        }
      />

      {rotas.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No rotas yet"
          description="Create your first rota — a job, a schedule, and the people who take turns."
          action={
            <Button asChild size="sm">
              <Link href="/rotas/new">
                <Plus /> New rota
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rotas.map((rota) => (
            <RotaCard key={rota.id} rota={rota} today={today} />
          ))}
        </div>
      )}
    </>
  );
}

function RotaCard({ rota, today }: { rota: Rota; today: string }) {
  const memberCount = rota.positions.length;
  const [next] = projectShifts({
    startsOn: rota.starts_on,
    intervalCount: rota.interval_count,
    intervalUnit: rota.interval_unit,
    roster: rota.positions,
    count: 1,
    fromDay: today,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{rota.name}</CardTitle>
        <CardDescription>
          {scheduleLabel(rota.interval_count, rota.interval_unit)} · reminders at{" "}
          {sendHourLabel(rota.send_hour)}
        </CardDescription>
        <CardAction>
          {rota.draft ? (
            <Badge variant="outline">Draft</Badge>
          ) : rota.active ? (
            <Badge variant="secondary">
              {memberCount} member{memberCount === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="outline">Paused</Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {rota.draft ? (
          "No one is on this rota yet, so nothing is scheduled and no texts go out."
        ) : next ? (
          <>
            Next up:{" "}
            <span className="text-foreground font-medium">{next.member.name}</span> on{" "}
            {formatShiftDate(dayStringToDisplayDate(next.dueOn))}
          </>
        ) : (
          "No upcoming shifts."
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/rotas/${rota.id}`}>Edit rota</Link>
        </Button>
        {rota.active ? (
          <DeactivateRotaButton rotaId={rota.id} rotaName={rota.name} />
        ) : null}
      </CardFooter>
    </Card>
  );
}
