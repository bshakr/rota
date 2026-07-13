"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/errors";
import type {
  IntervalUnit,
  Member,
  Rota,
  RotaWriteParams,
  ScheduleChangeWarning,
} from "@/lib/api/types";
import { formatLongDate, TIME_ZONE } from "@/lib/date";

import type { ActionResult } from "../action-result";
import { dayStringToDisplayDate, displayDateToDayString, sendHourLabel } from "../rota-logic";
import { MessagePreview } from "./message-preview";
import { ReminderOffsetsField } from "./reminder-offsets-field";
import { Textarea } from "./textarea";

const PLACEHOLDERS = ["{{name}}", "{{rota}}", "{{date}}", "{{days_until}}"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const rotaFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the rota a name.")
    .max(100, "Keep the name under 100 characters."),
  starts_on: z.string().min(1, "Pick a start date."),
  interval_count: z
    .number({ error: "Enter how often it repeats." })
    .int("Whole numbers only.")
    .min(1, "Repeat at least once per interval.")
    .max(365, "That's too far apart."),
  interval_unit: z.enum(["day", "week", "month"]),
  send_hour: z.number().int().min(0).max(23),
  active: z.boolean(),
  reminder_offsets: z.array(z.number().int().min(0)),
  message_template: z
    .string()
    .trim()
    .min(1, "Write the message people will get.")
    .max(1000, "Keep the message under 1000 characters."),
});

export type RotaFormValues = z.infer<typeof rotaFormSchema>;

// Field errors Rails returns key off the attribute name; they line up 1:1 with
// the form fields, so a validation_failed can be put back beside its input.
const FIELD_KEYS: (keyof RotaFormValues)[] = [
  "name",
  "starts_on",
  "interval_count",
  "interval_unit",
  "send_hour",
  "active",
  "reminder_offsets",
  "message_template",
];

function defaultsFrom(rota?: Rota): RotaFormValues {
  return {
    name: rota?.name ?? "",
    starts_on: rota?.starts_on ?? displayDateToDayString(new Date()),
    interval_count: rota?.interval_count ?? 1,
    interval_unit: rota?.interval_unit ?? "week",
    send_hour: rota?.send_hour ?? 9,
    active: rota?.active ?? true,
    reminder_offsets: rota?.reminder_offsets ?? [3, 0],
    message_template:
      rota?.message_template ??
      "Hi {{name}}! It's your turn for {{rota}} on {{date}} ({{days_until}}). Thanks 💛",
  };
}

/**
 * The rota's details: name, schedule, send hour, active state, reminder offsets,
 * and the message template. Shared by the create and edit screens.
 *
 * `save` is injected so this component stays ignorant of create-vs-edit. It always
 * submits WITHOUT confirmation first; if the API answers `confirmation_required`
 * (a schedule change that would drop covers), it surfaces the blocking dialog and
 * re-submits with `confirm: true`. Create never triggers that path — a brand-new
 * rota has no future shifts to lose.
 */
export function RotaDetailsForm({
  rota,
  members,
  submitLabel,
  save,
  onSaved,
}: {
  rota?: Rota;
  /** Group members for the live-preview recipient picker. Absent on create (no rota id yet). */
  members?: Member[];
  submitLabel: string;
  save: (params: RotaWriteParams, confirm: boolean) => Promise<ActionResult<{ rota: Rota }>>;
  onSaved: (rota: Rota) => void;
}) {
  const form = useForm<RotaFormValues>({
    resolver: zodResolver(rotaFormSchema),
    defaultValues: defaultsFrom(rota),
  });
  const { errors, isSubmitting } = form.formState;

  // A schedule change that would drop covers is held here until the admin confirms.
  const [pending, setPending] = React.useState<{
    values: RotaFormValues;
    warning: ScheduleChangeWarning;
  } | null>(null);

  function applyFieldErrors(fields?: Record<string, string[]>) {
    if (!fields) return;
    for (const key of FIELD_KEYS) {
      const messages = fields[key];
      if (messages?.length) form.setError(key, { message: messages.join(" ") });
    }
  }

  async function submit(values: RotaFormValues, confirm: boolean) {
    const result = await save(values, confirm);
    if (result.ok) {
      setPending(null);
      onSaved(result.data.rota);
      return;
    }

    const { error } = result;
    if (error.error === "confirmation_required" && error.warning) {
      setPending({ values, warning: error.warning as ScheduleChangeWarning });
      return;
    }
    applyFieldErrors(error.fields);
    toast.error(apiErrorMessage(error, "Couldn't save the rota."));
  }

  return (
    <>
      <form onSubmit={form.handleSubmit((values) => submit(values, false))}>
        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="rota-name">Name</FieldLabel>
            <Input
              id="rota-name"
              placeholder="Kitchen deep clean"
              aria-invalid={Boolean(errors.name)}
              {...form.register("name")}
            />
            <FieldError errors={[errors.name]} />
          </Field>

          <Field data-invalid={Boolean(errors.starts_on)}>
            <FieldLabel htmlFor="rota-starts-on">Starts on</FieldLabel>
            <Controller
              control={form.control}
              name="starts_on"
              render={({ field }) => (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="rota-starts-on"
                      type="button"
                      variant="outline"
                      data-icon="inline-start"
                      aria-invalid={Boolean(errors.starts_on)}
                      className="w-full justify-start font-normal"
                      onBlur={field.onBlur}
                    >
                      <CalendarIcon />
                      {field.value
                        ? formatLongDate(dayStringToDisplayDate(field.value))
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      timeZone={TIME_ZONE}
                      selected={field.value ? dayStringToDisplayDate(field.value) : undefined}
                      defaultMonth={
                        field.value ? dayStringToDisplayDate(field.value) : undefined
                      }
                      onSelect={(date) => date && field.onChange(displayDateToDayString(date))}
                    />
                  </PopoverContent>
                </Popover>
              )}
            />
            <FieldDescription>
              The anchor for the rotation. Shifts fall on this day and every interval after.
            </FieldDescription>
            <FieldError errors={[errors.starts_on]} />
          </Field>

          <Field orientation="responsive" data-invalid={Boolean(errors.interval_count)}>
            <FieldLabel htmlFor="rota-interval-count">Repeats every</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="rota-interval-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                className="w-24"
                aria-invalid={Boolean(errors.interval_count)}
                {...form.register("interval_count", { valueAsNumber: true })}
              />
              <Controller
                control={form.control}
                name="interval_unit"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => field.onChange(value as IntervalUnit)}
                  >
                    <SelectTrigger className="w-40" onBlur={field.onBlur}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">days</SelectItem>
                      <SelectItem value="week">weeks</SelectItem>
                      <SelectItem value="month">months</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <FieldError errors={[errors.interval_count]} />
          </Field>

          <Field data-invalid={Boolean(errors.send_hour)}>
            <FieldLabel htmlFor="rota-send-hour">Send reminders at</FieldLabel>
            <Controller
              control={form.control}
              name="send_hour"
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <SelectTrigger id="rota-send-hour" className="w-40" onBlur={field.onBlur}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {sendHourLabel(hour)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>In the group&apos;s timezone.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="rota-reminders">Reminders</FieldLabel>
            <Controller
              control={form.control}
              name="reminder_offsets"
              render={({ field }) => (
                <ReminderOffsetsField
                  id="rota-reminders"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FieldDescription>
              When to text before a shift. &ldquo;On the day&rdquo; is a reminder on the shift
              date itself.
            </FieldDescription>
          </Field>

          <Field data-invalid={Boolean(errors.message_template)}>
            <FieldLabel htmlFor="rota-message">Message</FieldLabel>
            <Textarea
              id="rota-message"
              rows={3}
              aria-invalid={Boolean(errors.message_template)}
              {...form.register("message_template")}
            />
            <FieldDescription>
              Placeholders:{" "}
              {PLACEHOLDERS.map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 ? " " : null}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{p}</code>
                </React.Fragment>
              ))}
              . The member&apos;s magic link is added automatically.
            </FieldDescription>
            <FieldError errors={[errors.message_template]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="rota-active">Status</FieldLabel>
            <Controller
              control={form.control}
              name="active"
              render={({ field }) => (
                <Select
                  value={field.value ? "active" : "paused"}
                  onValueChange={(value) => field.onChange(value === "active")}
                >
                  <SelectTrigger id="rota-active" className="w-40" onBlur={field.onBlur}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>
              Paused rotas keep their history but send no reminders.
            </FieldDescription>
          </Field>

          {rota && members ? (
            <MessagePreview rotaId={rota.id} members={members} control={form.control} />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Save the rota to see a live preview of the exact text, rendered against a real
              member.
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        </FieldGroup>
      </form>

      <ConfirmDialog
        destructive
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="This schedule change drops covers"
        confirmLabel="Change schedule"
        cancelLabel="Keep current schedule"
        description={pending ? <ScheduleWarningBody warning={pending.warning} /> : null}
        onConfirm={async () => {
          if (pending) await submit(pending.values, true);
        }}
      />
    </>
  );
}

// Names exactly what confirming will cost: the future shifts regenerate, and any
// cover on them is lost. A roster change never reaches here — that path preserves
// covers — so the asymmetry the ticket asks for is visible in the copy itself.
function ScheduleWarningBody({ warning }: { warning: ScheduleChangeWarning }) {
  return (
    <span className="block space-y-3">
      <span className="block">
        Moving the start date or interval regenerates{" "}
        <span className="font-medium text-foreground">
          {warning.future_shifts} future shift{warning.future_shifts === 1 ? "" : "s"}
        </span>{" "}
        onto new dates.
      </span>
      {warning.dropped_covers.length > 0 ? (
        <span className="block space-y-1">
          <span className="block">
            These agreed covers will be dropped and revert to the assignee:
          </span>
          <span className="block">
            {warning.dropped_covers.map((cover) => (
              <span key={cover.shift_id} className="block text-foreground">
                • {cover.covering_member_name} covering {cover.assigned_member_name} on{" "}
                {formatLongDate(dayStringToDisplayDate(cover.due_on))}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span className="block">No agreed covers are affected.</span>
      )}
    </span>
  );
}
