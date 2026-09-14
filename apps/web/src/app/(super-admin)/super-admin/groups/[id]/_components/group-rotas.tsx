import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GroupRota } from "@/lib/api/super-admin-groups";
import {
  reminderOffsetsInWords,
  rosterNote,
  rotaStateLabel,
  scheduleInWords,
  sendHourInWords,
} from "@/lib/hq-groups";
import { plural } from "@/lib/hq-overview";

import { Empty } from "./group-admins";

/**
 * What this house has set up to send.
 *
 * The API ships the schedule as its PARTS and no phrasing at all — there is no
 * "every other Tuesday" helper in this product, and inventing one in Ruby would
 * put the wording in the API instead of beside the rest of the console's copy. So
 * the words are made here, by the same helpers the house's own rota screens use
 * (`app/(admin)/rotas/rota-logic.ts`), which is what stops the console describing
 * a rota differently from the screen its admin is looking at.
 *
 * Three states, not two. A DRAFT has nobody on it; a PAUSED rota is fully staffed
 * and switched off. Both send nothing, for completely different reasons and with
 * completely different fixes, so folding them together would misreport why a
 * house is silent — which is the commonest question this page is opened to
 * answer.
 */
export function GroupRotas({ rotas, timezone }: { rotas: GroupRota[]; timezone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rotas</CardTitle>
        <CardDescription>
          {rotas.length === 0
            ? "No rotas, so this house sends nothing."
            : `${rotas.length} ${plural(rotas.length, "rota", "rotas")}. Send hours are in ${timezone}, this house's own timezone.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {rotas.length === 0 ? (
          <Empty>No rotas yet.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {rotas.map((rota) => (
              <RotaRow key={rota.id} rota={rota} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RotaRow({ rota }: { rota: GroupRota }) {
  const state = rotaStateLabel(rota);

  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-heading min-w-0 text-sm font-semibold break-words">{rota.name}</p>
        <Badge variant={state.tone}>{state.label}</Badge>
      </div>
      <p className="text-muted-foreground text-xs text-pretty">
        {scheduleInWords(rota)} · {sendHourInWords(rota.send_hour)}
      </p>
      <p className="text-muted-foreground text-xs text-pretty">
        {rosterNote(rota.roster_size)} · {reminderOffsetsInWords(rota.reminder_offsets)}
      </p>
    </li>
  );
}
