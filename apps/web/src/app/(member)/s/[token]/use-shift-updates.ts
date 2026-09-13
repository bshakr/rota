"use client";

import * as React from "react";

import type { MemberShift } from "@/lib/api/types";

import type { CoverActionResult } from "./action-result";

// The shift list's one piece of state, shared by the feed rows and the hand-off sheet
// so a hand-off arranged from either place updates the same array.
//
// This used to live inside shift-list.tsx, where it also DROPPED a shift that stopped
// involving the viewer. The feed shows the whole house, so nothing is ever dropped now:
// a shift you hand on stays on the page under its new owner's name, which is what a
// reload would show and is the point of a whole-house feed.

/** Hand this shift to another member. Bound to the token server-side; ids only here. */
export type AssignAction = (shiftId: number, coveringMemberId: number) => Promise<CoverActionResult>;

/** Take this shift back. Bound to the token server-side; the shift id only here. */
export type CancelAction = (shiftId: number) => Promise<CoverActionResult>;

export function useShiftUpdates(initial: MemberShift[]) {
  const [shifts, setShifts] = React.useState(initial);
  const [seed, setSeed] = React.useState(initial);

  // The page is force-dynamic, but a client-side navigation back to it hands the
  // component a fresh `initial` without remounting. Re-seed on identity change so the
  // feed never shows a stale array after a refresh.
  //
  // Adjusted DURING RENDER, not in an effect: React restarts this render immediately
  // with the new state and never commits the stale array, so there is no flash of the
  // old feed and no second paint. An effect would do both, and the react-hooks
  // set-state-in-effect rule rejects it. See "You Might Not Need an Effect".
  if (seed !== initial) {
    setSeed(initial);
    setShifts(initial);
  }

  // Replace the mutated shift with the server's authoritative version. Its can_* flags
  // are already resolved for this member, so every control re-renders from one value
  // rather than from a guess about what the mutation did.
  const applyUpdate = React.useCallback((updated: MemberShift) => {
    setShifts((prev) => prev.map((shift) => (shift.id === updated.id ? updated : shift)));
  }, []);

  return { shifts, applyUpdate };
}

/**
 * A Server Action can THROW only for a genuinely unreachable API; every ApiError comes
 * back as a value. Normalise the throw into the same shape so callers handle one case.
 */
export async function runAction(call: () => Promise<CoverActionResult>): Promise<CoverActionResult> {
  try {
    return await call();
  } catch {
    return { ok: false, error: { error: "request_failed" } };
  }
}
