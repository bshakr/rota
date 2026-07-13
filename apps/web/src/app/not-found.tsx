import Link from "next/link";
import { MapPinOff } from "lucide-react";

import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

// 404. Renders inside the bare root layout, so it works whether the missing URL
// looked like an admin route or a member link.
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Link href="/">
          <Wordmark muted />
        </Link>
      </header>
      <Container width="prose" className="flex flex-1 items-center py-16">
        <EmptyState
          icon={MapPinOff}
          title="This page isn't here"
          description="The link may be old, or mistyped. If it came from a text message about your turn, ask whoever sent it for a fresh one."
          action={
            <Button asChild variant="outline">
              <Link href="/">Back to the start</Link>
            </Button>
          }
          className="w-full"
        />
      </Container>
    </div>
  );
}
