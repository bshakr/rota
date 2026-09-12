import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in again" };

// A deliberate pause avoids an endless dashboard -> OAuth -> dashboard loop if
// Rails keeps rejecting the token. Starting OAuth belongs in a route handler.
//
// Soft Clay: the same shape as the setup card it usually follows, centred on
// the lavender page, with the peach coin the empty states wear so a dead end
// still looks like the rest of the product.
export default function ReauthenticatePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 pt-7 md:px-8">
        <Wordmark muted />
      </header>

      <Container asChild width="member">
        <main className="flex flex-1 items-center py-12 md:py-16">
          <Card className="animate-pop w-full text-center">
            <CardHeader className="items-center gap-3">
              <span
                className="animate-bob mx-auto grid size-14 place-items-center rounded-xl bg-peach text-plum shadow-xs"
                aria-hidden
              >
                <KeyRound className="size-6" strokeWidth={2.25} />
              </span>
              <CardTitle className="text-xl text-balance">
                <h1>One more sign-in, then you&apos;re in</h1>
              </CardTitle>
              <CardDescription className="text-pretty">
                We couldn&apos;t check your access to the house. Sign in again and
                we&apos;ll pick up where you left off. If it keeps happening, ask
                whoever set the house up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild size="lg" className="w-full sm:w-auto">
                <a href="/auth/sign-in">Sign in again</a>
              </Button>
            </CardContent>
          </Card>
        </main>
      </Container>
    </div>
  );
}
