"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toastApiError } from "@/lib/api/toast";

import { deactivateRotaAction } from "../actions";

/**
 * Retire a rota. It is a soft deactivate — history stands, the reminder sweep
 * just stops visiting it — so the copy says "pause", not "delete", and the confirm
 * is destructive-styled without pretending the data is gone.
 */
export function DeactivateRotaButton({ rotaId, rotaName }: { rotaId: number; rotaName: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      destructive
      trigger={
        <Button variant="ghost" size="sm">
          Pause
        </Button>
      }
      title={`Pause ${rotaName}?`}
      description="It keeps its history but stops generating shifts and sending reminders. You can reactivate it later from its editor."
      confirmLabel="Pause rota"
      onConfirm={async () => {
        const result = await deactivateRotaAction(rotaId);
        if (result.ok) {
          toast.success(`${rotaName} paused.`);
          router.refresh();
        } else {
          toastApiError(result.error, "Couldn't pause the rota.");
          throw new Error("deactivate failed"); // keep the dialog open
        }
      }}
    />
  );
}
