import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Rotas" };

export default function RotasPage() {
  return (
    <>
      <PageHeader
        title="Rotas"
        description="A named job, a schedule, and an ordered list of people taking turns."
      />
      <Placeholder ticket="BLO-1052" />
    </>
  );
}
