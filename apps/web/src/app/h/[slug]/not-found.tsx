import Link from "next/link";
import { MapPinOff } from "lucide-react";
import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

export default function HouseholdNotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/" prefetch={false}><Wordmark muted /></Link>
      </header>
      <Container asChild width="prose">
        <main className="flex flex-1 items-center py-16">
          <EmptyState
            icon={MapPinOff}
            title="We couldn’t find that household."
            description="Household links include a unique ending. If you’re a member, ask your household admin for the full link. If you’re the admin, copy it from your dashboard."
            action={
              <Button asChild>
                <Link href="/dashboard" prefetch={false}>Open admin dashboard</Link>
              </Button>
            }
            className="w-full"
          />
        </main>
      </Container>
    </div>
  );
}
