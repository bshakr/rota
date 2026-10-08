"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  daysBeforeFromTiming,
  MAX_DAYS_AFTER,
  MAX_DAYS_BEFORE,
  type TimingDirection,
  timingFromDaysBefore,
  withTimingDirection,
} from "../rota-logic";

/**
 * "[3] [days before]", "[on the day]", "[1] [day after]": a number and a direction,
 * so after a shift is as easy to pick as before. The value is the signed
 * `days_before`. An amount that is not a whole number of at least 1 is passed up
 * as NaN, so the form's validation names it instead of keeping a stale value.
 */
export function ReminderTimingField({
  id,
  value,
  onChange,
  onBlur,
  invalid,
}: {
  id: string;
  value: number;
  onChange: (daysBefore: number) => void;
  onBlur?: () => void;
  invalid?: boolean;
}) {
  const initial = timingFromDaysBefore(Number.isNaN(value) ? 0 : value);
  const [direction, setDirection] = React.useState<TimingDirection>(initial.direction);
  const [amountText, setAmountText] = React.useState(
    initial.direction === "on" ? "1" : String(initial.amount),
  );
  const amount = Number(amountText);

  function changeAmount(text: string) {
    setAmountText(text);
    const parsed = Number(text);
    const valid = text.trim() !== "" && Number.isInteger(parsed) && parsed >= 1;
    onChange(valid ? daysBeforeFromTiming({ amount: parsed, direction }) : Number.NaN);
  }

  function changeDirection(next: TimingDirection) {
    setDirection(next);
    if (next === "on") {
      onChange(0);
      return;
    }
    const from = Number.isNaN(value) || value === 0 ? 1 : value;
    const daysBefore = withTimingDirection(from, next);
    setAmountText(String(Math.abs(daysBefore)));
    onChange(daysBefore);
  }

  const singular = direction !== "on" && amount === 1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {direction !== "on" ? (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={direction === "after" ? MAX_DAYS_AFTER : MAX_DAYS_BEFORE}
          className="w-20"
          aria-label="Number of days"
          aria-invalid={invalid}
          value={amountText}
          onChange={(e) => changeAmount(e.target.value)}
          onBlur={onBlur}
        />
      ) : null}
      <Select value={direction} onValueChange={(next) => changeDirection(next as TimingDirection)}>
        <SelectTrigger
          id={direction === "on" ? id : undefined}
          className="w-40"
          aria-label="Before, on or after the shift"
          aria-invalid={invalid}
          onBlur={onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="before">{singular ? "day before" : "days before"}</SelectItem>
          <SelectItem value="on">On the day</SelectItem>
          <SelectItem value="after">{singular ? "day after" : "days after"}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
