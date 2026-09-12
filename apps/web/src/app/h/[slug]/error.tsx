"use client";

import { Button } from "@/components/ui/button";

export default function EntryError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 px-5 py-16">
      <h1 className="text-xl font-semibold">We couldn’t load this household</h1>
      <p>Please try again shortly. Links in your earlier reminder texts may still work.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
