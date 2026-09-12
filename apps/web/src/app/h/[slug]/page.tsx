import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicHousehold } from "@/lib/api/household-entry";
import { EntryForm } from "./entry-form";

export const metadata: Metadata = { title: "Your household", robots: { index: false, follow: false } };

export default async function HouseholdEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const household = await getPublicHousehold((await params).slug);
  if (!household) notFound();
  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-16">
      <Link href="/" prefetch={false} className="font-semibold">RotaMonster</Link>
      <Card>
        <CardHeader>
          <CardTitle><h1>{household.name}</h1></CardTitle>
          <CardDescription>Already part of this household? Get a private link to your member dashboard. Your admin must add your number first.</CardDescription>
        </CardHeader>
        <CardContent><EntryForm slug={household.slug} /></CardContent>
      </Card>
      <p className="text-muted-foreground text-center text-sm">
        Manage this household? <Link href="/dashboard" prefetch={false} className="text-primary underline">Admin sign in</Link>
      </p>
    </main>
  );
}
