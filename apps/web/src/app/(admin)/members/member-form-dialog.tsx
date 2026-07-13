"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import type { ApiErrorBody } from "@/lib/api/errors";
import { toastApiError } from "@/lib/api/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { createMemberAction, updateMemberAction } from "./actions";
import type { MemberRow } from "./data";

// Add or edit a member. Two layers of phone validation, on purpose:
//
//   - A light client check (`mode: "onTouched"`) so an empty or obviously-broken
//     field fails the moment the admin leaves it, before any round-trip.
//   - The authoritative check is Rails' — it normalises to E.164 and asks
//     libphonenumber whether the result is dialable, which the browser can't do
//     without shipping that whole dataset. When it rejects, its `validation_failed`
//     field message is put back ON the phone field, not into a toast: a bad number
//     is a silently missed reminder, so it has to fail visibly, in place.
const schema = z.object({
  name: z.string().trim().min(1, "Enter a name."),
  phone_e164: z
    .string()
    .trim()
    .min(1, "Enter a phone number.")
    .refine(
      (value) => (value.match(/\d/g) ?? []).length >= 7,
      "That doesn't look like a phone number. Try 07700 900123 or +44 7700 900123.",
    ),
});

type Values = z.infer<typeof schema>;

// The API returns ActiveModel's attribute→messages ("is not a valid phone
// number"), with no attribute name. Prefix a friendly one so the inline error
// reads as a sentence rather than a fragment.
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  phone_e164: "Phone number",
};

export function MemberFormDialog({
  member,
  onClose,
}: {
  /** Present = edit; absent = add. */
  member?: MemberRow;
  onClose: () => void;
}) {
  const isEdit = Boolean(member);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      name: member?.name ?? "",
      phone_e164: member?.phone_e164 ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  /** Put each server field error back beside its input. Returns whether any matched a form field. */
  function applyFieldErrors(error: ApiErrorBody): boolean {
    const fields = error.fields;
    if (!fields) return false;

    let applied = false;
    for (const key of ["name", "phone_e164"] as const) {
      const messages = fields[key];
      if (messages?.length) {
        form.setError(key, { message: `${FIELD_LABELS[key]} ${messages[0]}` }, { shouldFocus: !applied });
        applied = true;
      }
    }
    return applied;
  }

  async function onSubmit(values: Values) {
    try {
      const result = isEdit
        ? await updateMemberAction(member!.id, values)
        : await createMemberAction(values);

      if (result.ok) {
        const name = result.data.member.name;
        toast.success(isEdit ? `${name}'s details saved.` : `${name} added.`, {
          description: isEdit ? undefined : "They can go into any rota now.",
        });
        onClose();
        return;
      }

      // A field-level rejection lands on the input; anything else is a toast.
      if (!applyFieldErrors(result.error)) {
        toastApiError(result.error, isEdit ? "Couldn't save the changes." : "Couldn't add the member.");
      }
    } catch (error) {
      // The action returns ApiError failures as a value; it only THROWS for the
      // unexpected (the API host unreachable, so the fetch rejected before Rails
      // answered). Catch it so the dialog stays open with a toast rather than
      // letting the rejection go unhandled.
      toastApiError(error, isEdit ? "Couldn't save the changes." : "Couldn't add the member.");
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${member!.name}` : "Add a member"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update their name or mobile number. Reminders text this number."
              : "Everyone who takes a turn is added here once, then put into any rota. Reminders text the mobile number you enter."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="member-name">Name</FieldLabel>
              <Input
                id="member-name"
                autoComplete="off"
                aria-invalid={Boolean(errors.name)}
                {...form.register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={Boolean(errors.phone_e164)}>
              <FieldLabel htmlFor="member-phone">Phone number</FieldLabel>
              <Input
                id="member-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="07700 900123"
                aria-invalid={Boolean(errors.phone_e164)}
                {...form.register("phone_e164")}
              />
              <FieldDescription>
                UK or international. We store it in one standard format, so 07700 900123 and
                +44 7700 900123 both work.
              </FieldDescription>
              <FieldError errors={[errors.phone_e164]} />
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isEdit ? "Save changes" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
