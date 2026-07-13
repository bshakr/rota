import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone who takes a turn. Add them once; they can appear in any rota."
      />
      <Placeholder ticket="BLO-1051" />
    </>
  );
}
