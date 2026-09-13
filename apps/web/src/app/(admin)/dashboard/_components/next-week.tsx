"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { turnsLabel } from "./next-week-label";

// Where the open/closed choice is remembered. Per browser, not per account: this is a
// reading preference about one screen, not something worth a column and a round trip.
const STORAGE_KEY = "rota-monster:dashboard:next-week-open";

/**
 * The week after the glance, folded away.
 *
 * Closed by default, because the dashboard's job is the seven days in front of you and
 * a fortnight of rows would bury them. The header has to earn the click on its own, so
 * it carries the dates and the number of turns: an admin who only wants to know whether
 * next week is busy never has to open it.
 *
 * Native `<details>`, not a hand-rolled disclosure: it is keyboard-operable and
 * screen-reader-correct with no code, it opens even if the JavaScript that remembers
 * the choice never arrives, and the chevron turns off the `[open]` attribute in CSS
 * rather than off React state. The rows inside stay SERVER-rendered — they arrive as
 * `children`, so this client component never has to know what a shift is.
 *
 * The remembered choice is applied to the DOM, deliberately, rather than held in state.
 * The server has no localStorage, so a render that consulted it would produce one
 * markup on the server and another in the browser: a hydration mismatch on every load.
 * The element is left uncontrolled and nudged open a frame after mount instead.
 */
export function NextWeek({
  label,
  turnCount,
  children,
}: {
  /** The week's dates, e.g. "21–27 Sept". */
  label: string;
  turnCount: number;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const element = details.current;
    if (!element) return;
    try {
      element.open = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private mode, a blocked origin, a cleared store: the section simply stays
      // closed. Nothing here is worth failing a dashboard render over.
    }
  }, []);

  return (
    <details
      ref={details}
      onToggle={(event) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, event.currentTarget.open ? "1" : "0");
        } catch {
          // Same again: the section still opens, it just will not be open next time.
        }
      }}
      className="group"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 py-1 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
        <span className="font-heading text-sm leading-none font-semibold">Next week</span>
        <span className="text-muted-foreground text-xs leading-none tabular-nums">{label}</span>
        <span className="text-muted-foreground text-xs leading-none" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground text-xs leading-none">{turnsLabel(turnCount)}</span>
      </summary>

      <div className="mt-5">{children}</div>
    </details>
  );
}
