import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicHousehold } from "@/lib/api/household-entry";
import { EntryForm } from "./entry-form";

export const metadata: Metadata = { title: "Your household", robots: { index: false, follow: false } };

export default async function HouseholdEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const household = await getPublicHousehold((await params).slug);
  if (!household) notFound();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/" prefetch={false}><Wordmark muted /></Link>
      </header>
      <Container asChild width="member">
        <main className="flex-1 py-10 md:py-14">
          <Card className="animate-pop">
            <CardHeader>
              <CardTitle className="text-xl"><h1 className="break-words">{household.name}</h1></CardTitle>
              <CardDescription className="text-pretty">Your house, your rota. Get a private link to see what’s yours to do. Your admin needs to add your number first.</CardDescription>
            </CardHeader>
            <CardContent><EntryForm slug={household.slug} /></CardContent>
          </Card>
          <p className="text-muted-foreground mt-6 text-center text-sm">
            Manage this household? <Link href="/dashboard" prefetch={false} className="text-link underline">Admin sign in</Link>
          </p>
        </main>
      </Container>
    </div>
  );
}
