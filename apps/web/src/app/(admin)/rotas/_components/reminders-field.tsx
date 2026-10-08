"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, type UseFormReturn, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Member } from "@/lib/api/types";

import { MAX_REMINDERS, reminderTimingLabel } from "../rota-logic";
import { MessagePreview } from "./message-preview";
import { ReminderTimingField } from "./reminder-timing-field";
import type { RotaFormValues } from "./rota-details-form";

const PLACEHOLDERS = ["{{name}}", "{{rota}}", "{{date}}", "{{days_until}}"];

/**
 * The rota's reminders as a list: each row is a timing, its own message, and (on
 * edit) a live preview. Rows keep the order they were loaded or added in, because
 * that order is the index the API's `reminders[i].field` errors point at.
 */
export function RemindersField({
  form,
  defaultTemplate,
  rotaId,
  members,
}: {
  form: UseFormReturn<RotaFormValues>;
  defaultTemplate: string;
  /** Absent on create: there is no rota to render a preview against yet. */
  rotaId?: number;
  members?: Member[];
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "reminders",
    keyName: "key",
  });
  const errors = form.formState.errors.reminders;
  const listError = errors?.message ?? errors?.root?.message;
  const atCap = fields.length >= MAX_REMINDERS;

  const [memberId, setMemberId] = React.useState<number | undefined>(members?.[0]?.id);
  const recipient = members?.find((m) => m.id === memberId);
  const canPreview = rotaId !== undefined && recipient !== undefined;

  return (
    <FieldSet data-invalid={Boolean(listError)}>
      <FieldLegend variant="label">Reminders</FieldLegend>
      <FieldDescription>
        Each reminder is its own text, sent before, on or after the shift day. After the
        shift, it goes to whoever did it.
      </FieldDescription>

      {rotaId !== undefined && members && members.length > 0 ? (
        <div className="flex items-center gap-2">
          <Label htmlFor="preview-member" className="text-muted-foreground text-xs">
            Preview as
          </Label>
          <Select
            value={memberId !== undefined ? String(memberId) : undefined}
            onValueChange={(value) => setMemberId(Number(value))}
          >
            <SelectTrigger id="preview-member" size="sm" className="w-40">
              <SelectValue placeholder="Pick a member" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={String(member.id)}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {fields.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-3 text-sm">
          No reminders, so nobody on this rota gets a text. Add one below.
        </p>
      ) : (
        <ol className="space-y-4">
          {fields.map((field, index) => (
            <ReminderRow
              key={field.key}
              form={form}
              index={index}
              onRemove={() => remove(index)}
              preview={
                canPreview ? (
                  <MessagePreview
                    rotaId={rotaId}
                    memberId={recipient.id}
                    recipientName={recipient.name}
                    control={form.control}
                    index={index}
                  />
                ) : null
              }
            />
          ))}
        </ol>
      )}

      {rotaId === undefined ? (
        <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-3 text-sm">
          Save the rota to see a live preview of each text, rendered against a real person.
        </p>
      ) : members && members.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-3 text-sm">
          Add someone to your house to preview the messages against a real recipient.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={atCap}
          onClick={() => append({ days_before: 0, message_template: defaultTemplate })}
        >
          <Plus /> Add reminder
        </Button>
        {atCap ? (
          <span className="text-muted-foreground text-sm">
            That&apos;s the most a rota can have ({MAX_REMINDERS}).
          </span>
        ) : null}
      </div>
      <FieldError>{listError}</FieldError>
    </FieldSet>
  );
}

function ReminderRow({
  form,
  index,
  onRemove,
  preview,
}: {
  form: UseFormReturn<RotaFormValues>;
  index: number;
  onRemove: () => void;
  preview: React.ReactNode;
}) {
  const daysBefore = useWatch({ control: form.control, name: `reminders.${index}.days_before` });
  const rowErrors = form.formState.errors.reminders?.[index];
  const timingId = `reminder-${index}-timing`;
  const messageId = `reminder-${index}-message`;
  const title = Number.isInteger(daysBefore)
    ? reminderTimingLabel(daysBefore)
    : `Reminder ${index + 1}`;

  return (
    <li className="border-border space-y-4 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-heading text-sm font-semibold">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove reminder ${index + 1}`}
        >
          <Trash2 />
        </Button>
      </div>

      <Field data-invalid={Boolean(rowErrors?.days_before)}>
        <FieldLabel htmlFor={timingId}>When</FieldLabel>
        <Controller
          control={form.control}
          name={`reminders.${index}.days_before`}
          render={({ field }) => (
            <ReminderTimingField
              id={timingId}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={Boolean(rowErrors?.days_before)}
            />
          )}
        />
        <FieldError errors={[rowErrors?.days_before]} />
      </Field>

      <Field data-invalid={Boolean(rowErrors?.message_template)}>
        <FieldLabel htmlFor={messageId}>Message</FieldLabel>
        <Textarea
          id={messageId}
          rows={3}
          aria-invalid={Boolean(rowErrors?.message_template)}
          {...form.register(`reminders.${index}.message_template`)}
        />
        <FieldDescription>
          Placeholders:{" "}
          {PLACEHOLDERS.map((p, i) => (
            <React.Fragment key={p}>
              {i > 0 ? " " : null}
              <code className="bg-muted rounded-full px-2 py-0.5 font-mono text-xs">{p}</code>
            </React.Fragment>
          ))}
          . The member&apos;s magic link is added automatically.
        </FieldDescription>
        <FieldError errors={[rowErrors?.message_template]} />
      </Field>

      {preview}
    </li>
  );
}
