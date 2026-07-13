"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastApiError } from "@/lib/api/toast";
import type { Group } from "@/lib/api/types";

import { saveGroupSettings } from "../actions";

const schema = z.object({
  name: z.string().trim().min(1, "Give the group a name."),
  timezone: z.string().min(1, "Choose a timezone."),
});
type Values = z.infer<typeof schema>;

// Every IANA zone the browser knows, with the group's stored zone guaranteed
// present so it preselects and confirming a correct guess is one tap. Rails
// rejects anything it doesn't recognise, surfaced inline below the field.
function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.includes(current) ? supported : [current, ...supported];
}

/**
 * Group settings — name and, the one that matters, timezone. It lives on the
 * dashboard because that is where its warning lives: the unconfirmed-timezone
 * Alert links straight down to this section (`#group-settings`), so the complaint
 * and the fix are the same screen. Saving a timezone confirms it and clears the
 * warning (Rails stamps `timezone_confirmed_at` whenever `timezone` is sent).
 */
export function GroupSettings({ group }: { group: Group }) {
  const zones = React.useMemo(() => timezoneOptions(group.timezone), [group.timezone]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: group.name, timezone: group.timezone },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await saveGroupSettings(values);
    if (!result.ok) {
      // Put Rails' own message back beside the field it names (e.g. an
      // unrecognised timezone), then toast the summary.
      const fieldError = result.error.fields?.timezone?.[0];
      if (fieldError) form.setError("timezone", { message: fieldError });
      toastApiError(result.error, "Couldn't save the group settings.");
      return;
    }
    form.reset({ name: result.group.name, timezone: result.group.timezone });
    toast.success("Group settings saved.");
  });

  return (
    <Card id="group-settings" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>Group settings</CardTitle>
        <CardDescription>
          This house&apos;s name and timezone. Every reminder is sent at its rota&apos;s send hour
          in this timezone, so a wrong one texts everyone at the wrong hour.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-sm">
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="group-name">Name</FieldLabel>
              <Input
                id="group-name"
                aria-invalid={Boolean(errors.name)}
                {...form.register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={Boolean(errors.timezone)}>
              <FieldLabel htmlFor="group-timezone">Timezone</FieldLabel>
              <Controller
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="group-timezone"
                      className="w-full"
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.timezone)}
                    >
                      <SelectValue placeholder="Pick a timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((zone) => (
                        <SelectItem key={zone} value={zone}>
                          {zone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                {group.timezone_confirmed
                  ? "Confirmed."
                  : "Never confirmed — a guess until you save it."}
              </FieldDescription>
              <FieldError errors={[errors.timezone]} />
            </Field>

            <Button type="submit" size="lg" loading={isSubmitting} className="w-full sm:w-auto">
              Save settings
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
