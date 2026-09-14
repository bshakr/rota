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
import { RESUME_CONSEQUENCES, SUSPENSION_CONSEQUENCES, notesCounter } from "@/lib/hq-groups";
// The one timezone list in the product, shared with the house's own settings
// form: an operator fixing a house's clock and an admin fixing their own must be
// offered the same zones.
import { timezoneOptions } from "@/lib/timezones";
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
 *
 * Since https://github.com/bshakr/rota/pull/45 that rejection is also reported to
 * Sentry, which is right for a write Rails refused. The message thrown is
 * therefore the same sentence the operator was just shown, so whoever triages it
 * can tell at a glance which of these three actions failed.
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
 * The house's own settings form says "Give the group a name."; this says "house",
 * because that is the word the operator area uses for the same thing everywhere
 * else on the page.
 */
const NAME_REQUIRED = "Give the house a name.";

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
      onConfirm={() => {
        // Checked here as well as inline, because `onConfirm` is what the button
        // actually runs. Rails rejects a blank name too and that path still
        // works; this only spares the operator a round trip to be told something
        // the field already knew. Throwing is what keeps the dialog open — see
        // `run` above.
        //
        // KNOWN NOISE: `ConfirmDialog` now reports a rejected confirm to Sentry,
        // and this one is a deliberate refusal rather than a failure, so it will
        // show up there. The message is the operator's own sentence so it is
        // recognisable on sight. Worth closing properly by teaching
        // `ConfirmDialog` to tell an expected refusal from a real one, which is
        // a change to a shared component and not this ticket's to make.
        if (!draft.current.name.trim()) {
          toast.error(NAME_REQUIRED);
          throw new Error(NAME_REQUIRED);
        }

        return run(
          () =>
            saveGroupSettings(groupId, {
              name: draft.current.name.trim(),
              timezone: draft.current.timezone,
            }),
          "Couldn't save this house.",
          "House saved.",
        );
      }}
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
  // No "touched" flag: the box opens carrying the house's real name, so the only
  // way it can be empty is that somebody emptied it. The message is then a
  // description of what they just did, not a telling-off for not having typed
  // yet. Same sentence and same moment as the house's own form.
  const missing = draft.name.trim() === "";

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
          aria-invalid={missing}
          aria-describedby={missing ? "hq-group-name-error" : undefined}
        />
        {missing ? (
          <span id="hq-group-name-error" className="text-destructive block text-sm">
            {NAME_REQUIRED}
          </span>
        ) : null}
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
        // DELIBERATELY NOT `maxLength`. A hard cap on the control stops accepting
        // keystrokes with no explanation at all — the operator pastes a
        // paragraph, watches half of it not arrive, and has to guess why. Without
        // it the counter's over-limit branch is reachable, so the box says "47
        // over the 2,000 limit" in the went-wrong ink and the operator can see
        // exactly how much to cut. Rails is still the enforcement
        // (`Group::NOTES_MAX`), and its refusal comes back as a toast.
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
