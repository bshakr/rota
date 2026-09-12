"use client";

import { useActionState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { setupHousehold } from "./actions";

// The dropdowns stay NATIVE <select>s: the timezone list is every zone the
// runtime knows, and this form is a plain POST to a Server Action, so a Radix
// Select would only add a Controller and a hidden input to say the same thing.
// They wear the same pill <Input> wears (h-10, the --input boundary, white
// clay), so a text field and a dropdown in one card do not read as two
// different controls.
const SELECT_CLASS =
  "h-10 w-full appearance-none rounded-full border border-input bg-card py-2 pr-10 pl-4 text-base shadow-xs transition-colors outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring md:text-sm";

// SelectTrigger's chevron, laid over an appearance-none control. An icon rather
// than a background image, because a background image would need a raw colour.
function SelectChevron() {
  return (
    <ChevronDown
      className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden
    />
  );
}

export function SetupForm({ households, timezones }: {
  households: { id: string; name: string }[];
  timezones: string[];
}) {
  const [state, action, pending] = useActionState(setupHousehold, { error: "" });
  const returning = households.length > 0;

  return (
    <form action={action}>
      <FieldGroup>
        {returning ? (
          <Field>
            <FieldLabel htmlFor="setup-household">Your house</FieldLabel>
            <div className="relative">
              <select id="setup-household" name="organizationId" className={SELECT_CLASS} required>
                {households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="setup-name">House name</FieldLabel>
              <Input id="setup-name" name="name" placeholder="Our house" maxLength={100} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-timezone">Timezone</FieldLabel>
              <div className="relative">
                <select id="setup-timezone" name="timezone" defaultValue="Europe/London" className={SELECT_CLASS} required>
                  {timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
                <SelectChevron />
              </div>
              <FieldDescription>Reminders go out on this clock, so give it a quick look.</FieldDescription>
            </Field>
          </>
        )}

        {/* The blush "went wrong" sticker, which already carries role="alert".
            Every message here is recoverable by reloading, so the way out sits
            in the same breath as the problem. */}
        {state.error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription>
              {state.error}{" "}
              <a href="/setup" className="font-medium">Refresh this page</a>
            </AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" loading={pending} className="w-full">
          {returning ? "Carry on" : "Create your house"}
        </Button>
      </FieldGroup>
    </form>
  );
}
