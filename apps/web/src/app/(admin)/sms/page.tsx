import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "SMS log" };

export default function SmsLogPage() {
  return (
    <>
      <PageHeader
        title="SMS log"
        description="Every message sent, with its carrier delivery status. The screen that answers “why didn't Alice get her text”."
      />
      <Placeholder ticket="BLO-1054" />
    </>
  );
}
