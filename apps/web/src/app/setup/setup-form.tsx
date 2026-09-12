"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setupHousehold } from "./actions";

export function SetupForm({ households, timezones }: {
  households: { id: string; name: string }[];
  timezones: string[];
}) {
  const [state, action, pending] = useActionState(setupHousehold, { error: "" });
  return (
    <form action={action} className="space-y-6">
      {households.length ? (
        <label className="grid gap-2 text-sm font-medium">
          Household
          <select name="organizationId" className="h-11 rounded-lg border bg-background px-3" required>
            {households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
          </select>
        </label>
      ) : (
        <>
          <label className="grid gap-2 text-sm font-medium">
            Household name
            <Input name="name" placeholder="Our house" maxLength={100} required />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Timezone
            <select name="timezone" defaultValue="Europe/London" className="h-11 rounded-lg border bg-background px-3" required>
              {timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <span className="font-normal text-muted-foreground">Reminders use this timezone. Check it before continuing.</span>
          </label>
        </>
      )}
      {state.error ? <div className="space-y-2 text-sm">
        <p role="alert" className="text-destructive">{state.error}</p>
        <a href="/setup" className="text-primary underline underline-offset-4">Reload saved setup</a>
      </div> : null}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {households.length ? "Continue to household" : "Create household"}
      </Button>
    </form>
  );
}
