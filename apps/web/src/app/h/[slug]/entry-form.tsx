"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendEntryLink } from "./actions";

export function EntryForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(sendEntryLink.bind(null, slug), { message: "" });
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="entry-phone" className="text-sm font-medium">Your mobile number</label>
        <Input id="entry-phone" name="phone" type="tel" autoComplete="tel" maxLength={40}
          placeholder="+44 7700 900123" required aria-describedby="entry-phone-help" />
        <p id="entry-phone-help" className="text-muted-foreground text-sm">
          Use the number your household admin added, including the country code.
        </p>
      </div>
      <Button type="submit" size="lg" loading={pending} className="w-full">Text me my link</Button>
      <p role={state.error ? "alert" : "status"} className="text-sm">{state.message}</p>
      <p className="text-muted-foreground text-sm">
        No text? Check the number with your household admin. You can also use a link from an earlier reminder.
      </p>
    </form>
  );
}
