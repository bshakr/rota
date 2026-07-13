"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { reminderOffsetLabel, sortOffsetsDesc } from "../rota-logic";

// Reminder offsets as the chip list the ticket asks for: "7 days before ×",
// "on the day ×", "+ add". The value is the rota's `reminder_offsets` int array
// (days before a shift; `0` is the day itself). Controlled, so it drops straight
// into the form through a Controller.

const QUICK_PICKS = [7, 3, 1, 0];
const MAX_OFFSET = 365;

export function ReminderOffsetsField({
  id,
  value,
  onChange,
  onBlur,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  value: number[];
  onChange: (next: number[]) => void;
  onBlur?: () => void;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState("");
  const chips = sortOffsetsDesc(value);

  function add(days: number) {
    if (!value.includes(days)) onChange(sortOffsetsDesc([...value, days]));
  }

  function remove(days: number) {
    onChange(value.filter((v) => v !== days));
    onBlur?.();
  }

  function addCustom() {
    const parsed = Number(custom);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_OFFSET) return;
    add(parsed);
    setCustom("");
    setOpen(false);
    onBlur?.();
  }

  const remainingPicks = QUICK_PICKS.filter((p) => !value.includes(p));

  return (
    <div id={id} className="flex flex-wrap items-center gap-2" aria-invalid={ariaInvalid}>
      {chips.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No reminders yet — add at least one so people get a text.
        </span>
      ) : (
        chips.map((days) => (
          <span
            key={days}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary py-1 pr-1 pl-3 text-sm text-secondary-foreground"
          >
            {reminderOffsetLabel(days)}
            <button
              type="button"
              onClick={() => remove(days)}
              aria-label={`Remove reminder ${reminderOffsetLabel(days)}`}
              className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors outline-hidden hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Plus /> Add
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3">
          {remainingPicks.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Common</p>
              <div className="flex flex-wrap gap-1.5">
                {remainingPicks.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      add(p);
                      onBlur?.();
                    }}
                  >
                    {reminderOffsetLabel(p)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="reminder-custom">Days before (0 = on the day)</Label>
            <div className="flex gap-2">
              <Input
                id="reminder-custom"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_OFFSET}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder="e.g. 2"
              />
              <Button type="button" onClick={addCustom} disabled={custom === ""}>
                Add
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
