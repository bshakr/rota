import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicHousehold } from "@/lib/api/household-entry";

import { EntryScreen } from "./entry-screen";

export const metadata: Metadata = { title: "Your household", robots: { index: false, follow: false } };

/**
 * The page a housemate lands on from a shared link: it asks Rails which house
 * `:slug` names and hands the answer to `EntryScreen`. An unknown house — and, by
 * design, nothing else — is a 404.
 */
export default async function HouseholdEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const household = await getPublicHousehold((await params).slug);
  if (!household) notFound();
  return <EntryScreen household={household} />;
}
