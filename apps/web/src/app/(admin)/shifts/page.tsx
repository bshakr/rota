import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Shifts" };

export default function ShiftsPage() {
  return (
    <>
      <PageHeader
        title="Upcoming shifts"
        description="Every turn coming up, covers included. Override any of them."
      />
      <Placeholder ticket="BLO-1053" />
    </>
  );
}
