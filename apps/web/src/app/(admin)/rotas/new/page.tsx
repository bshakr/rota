import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

import { RotaCreateForm } from "../_components/rota-create-form";
import { todayDayString } from "../rota-logic";

export const metadata: Metadata = { title: "New rota" };

export default function NewRotaPage() {
  return (
    <>
      <PageHeader
        title="New rota"
        description="Set the job, its schedule, and the message. You'll add the roster next."
        actions={
          <Button asChild variant="outline">
            <Link href="/rotas">All rotas</Link>
          </Button>
        }
      />
      <RotaCreateForm defaultStartsOn={todayDayString()} />
    </>
  );
}
