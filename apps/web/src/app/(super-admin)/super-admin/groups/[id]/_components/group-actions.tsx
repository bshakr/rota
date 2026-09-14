"use client";

import * as React from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toastApiError } from "@/lib/api/toast";
import {
  NOTES_MAX,
  RESUME_CONSEQUENCES,
  SUSPENSION_CONSEQUENCES,
  notesCounter,
} from "@/lib/hq-groups";
import { cn } from "@/lib/utils";

import {
  type GroupActionResult,
  resumeHouse,
  saveGroupNotes,
  saveGroupSettings,
  suspendHouse,
} from "../actions";

// The three things an operator can DO to a house, all behind the shared
// `ConfirmDialog` — the one component in this system whose hierarchy is already
// right (confirm prominent, cancel the friendly lilac that a stray Enter lands
// on) and which keeps itself open while an async confirm is in flight.
//
// A CLIENT COMPONENT THAT TAKES PRIMITIVES, never the payload. The operator API
// module is `server-only` and this page is server-rendered; handing this the
// `GroupRow` type would drag that module's import into a browser chunk, which is
// what bundle-safety.test.ts exists to stop. It needs five fields, so it is given
// five fields.
//
// `ConfirmDialog` renders its `description` inside a `<p>`, so everything below
// is phrasing content — spans with ARIA list semantics rather than a `<ul>`,
// labels and controls rather than the `Field` wrappers, which are divs. Valid
// markup matters here beyond pedantry: a `<div>` inside a `<p>` is closed by the
// parser mid-element, and React then hydrates a tree the browser never built.
//
// THE FIELDS OWN THEIR OWN DRAFT and report it upward into a ref. Radix unmounts
// a dialog's content when it closes, so each open gets a fresh component seeded
// from the current props — which is how a cancelled edit does not come back next
// time without a single effect chasing a prop.

export function GroupActions({
  groupId,
  name,
  timezone,
  notes,
  suspended,
}: {
  groupId: number;
  name: string;
  timezone: string;
  notes: string | null;
  suspended: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SettingsAction groupId={groupId} name={name} timezone={timezone} />
      <NotesAction groupId={groupId} notes={notes} />
      <SuspensionAction groupId={groupId} name={name} suspended={suspended} />
    </div>
  );
}

/**
 * Run a write, toast what went wrong, and RE-THROW on failure.
 *
 * The throw is the contract with `ConfirmDialog`: a rejected `onConfirm` leaves
 * the dialog open so the operator can fix the field and try again, where a
 * resolved one closes it. A dialog that closed over a failed save would look
 * exactly like a dialog that closed over a successful one.
 */
async function run(
  write: () => Promise<GroupActionResult>,
  fallback: string,
  success: string,
): Promise<void> {
  const result = await write();
  if (!result.ok) {
    toastApiError(result.error, fallback);
    throw new Error(fallback);
  }
  toast.success(success);
}

// --- Rename and set the timezone --------------------------------------------

/**
 * Every IANA zone the browser knows, with the house's stored zone guaranteed
 * present so it preselects and confirming a correct guess is one tap. Rails
 * rejects anything it does not recognise; the same helper the house's own
 * settings form uses, for the same reason.
 */
function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.includes(current) ? supported : [current, ...supported];
}

function SettingsAction({
  groupId,
  name,
  timezone,
}: {
  groupId: number;
  name: string;
  timezone: string;
}) {
  // The draft lives in a ref because `onConfirm` needs to read it and nothing on
  // this side of the dialog needs to re-render when it changes. Re-seeded on
  // every open, so a cancelled edit is genuinely cancelled — which is why the
  // dialog is CONTROLLED here: `ConfirmDialog` treats an `onOpenChange` without
  // an `open` as "the parent owns this", and would never open by itself.
  const draft = React.useRef({ name, timezone });
  const [open, setOpen] = React.useState(false);

  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Rename &amp; timezone</Button>}
      title="Rename this house, or set its timezone"
      confirmLabel="Save"
      open={open}
      onOpenChange={(next) => {
        if (next) draft.current = { name, timezone };
        setOpen(next);
      }}
      description={
        <>
          {/* The one consequence worth stating before it happens: saving a
              timezone here CONFIRMS it, and the house's own "confirm your
              timezone" warning disappears without anyone in the house touching
              it. Rails stamps `timezone_confirmed_at` whenever the param is
              present, and a super admin setting it counts as a human confirming
              it — the same rule as the house's own settings form. */}
          Saving a timezone confirms it for the house, exactly as an admin saving it there would:
          their &ldquo;confirm your timezone&rdquo; warning clears. Every reminder goes out at its
          rota&rsquo;s send hour in this zone.
          <SettingsFields
            name={name}
            timezone={timezone}
            onChange={(next) => {
              draft.current = next;
            }}
          />
        </>
      }
      onConfirm={() =>
        run(
          () =>
            saveGroupSettings(groupId, {
              name: draft.current.name.trim(),
              timezone: draft.current.timezone,
            }),
          "Couldn't save this house.",
          "House saved.",
        )
      }
    />
  );
}

function SettingsFields({
  name,
  timezone,
  onChange,
}: {
  name: string;
  timezone: string;
  onChange: (next: { name: string; timezone: string }) => void;
}) {
  // Mounted fresh each time the dialog opens (Radix unmounts closed content), so
  // the props ARE the initial value and there is nothing to synchronise.
  const [draft, setDraft] = React.useState({ name, timezone });
  const zones = React.useMemo(() => timezoneOptions(timezone), [timezone]);

  function update(next: { name: string; timezone: string }) {
    setDraft(next);
    onChange(next);
  }

  return (
    <>
      <span className="mt-4 block space-y-1.5">
        <Label htmlFor="hq-group-name">Name</Label>
        <Input
          id="hq-group-name"
          value={draft.name}
          onChange={(event) => update({ ...draft, name: event.target.value })}
          autoComplete="off"
        />
      </span>
      <span className="mt-3 block space-y-1.5">
        <Label htmlFor="hq-group-timezone">Timezone</Label>
        <Select
          value={draft.timezone}
          onValueChange={(value) => update({ ...draft, timezone: value })}
        >
          <SelectTrigger id="hq-group-timezone" className="w-full">
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
      </span>
    </>
  );
}

// --- The operator's note ----------------------------------------------------

function NotesAction({ groupId, notes }: { groupId: number; notes: string | null }) {
  const draft = React.useRef(notes ?? "");
  const [open, setOpen] = React.useState(false);

  return (
    <ConfirmDialog
      trigger={<Button variant="outline">{notes ? "Edit note" : "Add a note"}</Button>}
      title="Your note about this house"
      confirmLabel="Save note"
      open={open}
      onOpenChange={(next) => {
        if (next) draft.current = notes ?? "";
        setOpen(next);
      }}
      description={
        <>
          Only operators see this. Clearing the box removes the note.
          <NotesField
            initial={notes ?? ""}
            onChange={(value) => {
              draft.current = value;
            }}
          />
        </>
      }
      onConfirm={() =>
        run(
          () => saveGroupNotes(groupId, draft.current.trim()),
          "Couldn't save the note.",
          draft.current.trim() ? "Note saved." : "Note cleared.",
        )
      }
    />
  );
}

function NotesField({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  const counter = notesCounter(value);

  return (
    <span className="mt-4 block space-y-1.5">
      <Label htmlFor="hq-group-notes">Note</Label>
      <Textarea
        id="hq-group-notes"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onChange(event.target.value);
        }}
        // Bounded here as well as in Rails. `maxLength` stops a paste at the
        // ceiling rather than letting the operator write 2,400 characters and
        // lose 400 of them to a validation error they have to read to understand.
        // The counter is what keeps it honest: a control that silently stops
        // accepting keystrokes is worse than one that says why.
        maxLength={NOTES_MAX}
        aria-describedby="hq-group-notes-counter"
        placeholder="Trial house for the school run. Chasing them about the card that keeps declining."
      />
      <span
        id="hq-group-notes-counter"
        className={cn(
          "block text-right text-xs",
          counter.over ? "text-destructive font-medium" : "text-muted-foreground",
        )}
        // Politely, not assertively: it changes on every keystroke, and an
        // assertive region would interrupt the typing it is describing.
        aria-live="polite"
      >
        {counter.text}
      </span>
    </span>
  );
}

// --- Suspend and resume -----------------------------------------------------

function SuspensionAction({
  groupId,
  name,
  suspended,
}: {
  groupId: number;
  name: string;
  suspended: boolean;
}) {
  const consequences = suspended ? RESUME_CONSEQUENCES : SUSPENSION_CONSEQUENCES;

  return (
    <ConfirmDialog
      trigger={
        <Button variant={suspended ? "default" : "outline"}>
          {suspended ? "Resume this house" : "Pause this house"}
        </Button>
      }
      title={suspended ? `Resume ${name}?` : `Pause ${name}?`}
      confirmLabel={suspended ? "Resume it" : "Pause it"}
      // The PILL for a suspended house is never `destructive` — nothing went
      // wrong, somebody decided — but this button is, and deliberately. It stops
      // a real house's reminders from the next sweep, and the saturated red is
      // how this system says "this happens now".
      destructive={!suspended}
      description={
        <>
          {suspended
            ? "Everything suspension switched off comes back on:"
            : "Here is exactly what changes:"}
          <span role="list" className="mt-3 block space-y-1.5">
            {consequences.map((line) => (
              <span key={line} role="listitem" className="block">
                {line}
              </span>
            ))}
          </span>
        </>
      }
      onConfirm={() =>
        suspended
          ? run(
              () => resumeHouse(groupId),
              "Couldn't resume this house.",
              `${name} is running again.`,
            )
          : run(() => suspendHouse(groupId), "Couldn't pause this house.", `${name} is paused.`)
      }
    />
  );
}
