"use client";

import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Member, Rota } from "@/lib/api/types";

import { updateRotaAction } from "../actions";
import { RosterEditor } from "./roster-editor";
import { RotaDetailsForm } from "./rota-details-form";

/**
 * The edit screen, client side. Two operations, deliberately kept apart because
 * the backend treats them differently:
 *
 *   - Details (schedule included) → `updateRotaAction`, which triggers the
 *     destructive schedule-change confirm when covers would be dropped.
 *   - Roster → `RosterEditor`, which preserves covers and never warns.
 */
export function RotaEditor({
  rota,
  members,
  todayDay,
}: {
  rota: Rota;
  members: Member[];
  todayDay: string;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {rota.draft ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>This rota is a draft</AlertTitle>
          <AlertDescription>
            No one is on the roster yet, so it generates no shifts and sends no texts. Add
            members in the roster below to bring it to life.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name, schedule, reminders, and the message.</CardDescription>
        </CardHeader>
        <CardContent>
          <RotaDetailsForm
            rota={rota}
            members={members}
            defaultStartsOn={rota.starts_on}
            submitLabel="Save changes"
            save={(params, confirm) => updateRotaAction(rota.id, params, confirm)}
            onSaved={() => {
              toast.success("Rota saved.");
              router.refresh();
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardDescription>
            Drag to set the order — that order is the rotation. Changing it keeps any covers
            people have already agreed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RosterEditor
            rotaId={rota.id}
            initialRoster={rota.positions}
            allMembers={members}
            startsOn={rota.starts_on}
            intervalCount={rota.interval_count}
            intervalUnit={rota.interval_unit}
            todayDay={todayDay}
          />
        </CardContent>
      </Card>
    </div>
  );
}
