"use client";

import * as React from "react";

// The one viewport question this product asks in JavaScript. Everything else is a
// Tailwind breakpoint; this exists only because the hand-off flow is a genuinely
// DIFFERENT component on each side of the line (a bottom Sheet on a phone, a centred
// Dialog on a desktop), and CSS cannot swap a component.
//
// 1024px is Tailwind's `lg`, the same line the feed's two-column layout uses.
//
// useSyncExternalStore, not useEffect: the server snapshot is `false`, so the first
// paint is the PHONE layout everywhere, and a desktop upgrades on hydration. That is
// the right default (this page is opened from a text message) and it makes the
// server and client render agree, which an effect-based read would not.
const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useIsDesktop(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}
