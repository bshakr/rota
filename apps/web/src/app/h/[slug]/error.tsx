"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Wordmark } from "@/components/wordmark";

export default function EntryError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/" prefetch={false}><Wordmark muted /></Link>
      </header>
      <Container asChild width="prose">
        <main className="flex flex-1 items-center py-16">
          <EmptyState
            icon={TriangleAlert}
            title="That one is on us."
            description="We couldn’t load your household. Try again in a moment. Links in your earlier reminder texts may still work."
            action={<Button onClick={reset}>Try again</Button>}
            className="w-full"
          />
        </main>
      </Container>
    </div>
  );
}
