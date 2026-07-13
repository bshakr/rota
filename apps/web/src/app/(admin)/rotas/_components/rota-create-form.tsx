"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createRotaAction } from "../actions";
import { RotaDetailsForm } from "./rota-details-form";

/**
 * Create is deliberately just the details — there is no rota id yet, so no live
 * message preview and no roster. On success we land on the edit screen, which is
 * where the preview and the drag-to-order roster live. A rota with no roster is a
 * draft, which the edit screen states plainly.
 */
export function RotaCreateForm({ defaultStartsOn }: { defaultStartsOn: string }) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl">
      <RotaDetailsForm
        defaultStartsOn={defaultStartsOn}
        submitLabel="Create rota"
        save={(params) => createRotaAction(params)}
        onSaved={(rota) => {
          toast.success("Rota created.", { description: "Now add its roster." });
          router.push(`/rotas/${rota.id}`);
        }}
      />
    </div>
  );
}
