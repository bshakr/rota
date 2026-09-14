"use client";

import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export async function copyHouseholdLink(path: string) {
  try {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
    toast.success("Household link copied.");
  } catch {
    toast.error("Couldn’t copy the link. Open the household page and copy its address.");
  }
}

export function HouseholdEntryLink({ slug }: { slug: string }) {
  // Use the stored slug, including its unique suffix. A name is not a URL.
  const path = `/h/${slug}`;
  return (
    <section aria-label="Household entry page" className="mb-8 flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="font-heading text-lg font-semibold">Your household page</h2>
        <p className="text-muted-foreground text-sm">Add members and their phone numbers, then share this link.</p>
        <a href={path} className="text-link break-all text-sm underline">{path}</a>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={path}><ExternalLink aria-hidden />Open household page</a>
        </Button>
        <Button type="button" variant="secondary" onClick={() => copyHouseholdLink(path)}>
          <Copy aria-hidden />Copy link
        </Button>
      </div>
    </section>
  );
}
