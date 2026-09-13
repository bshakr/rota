"use client";

import { useEffect, useRef } from "react";

import { track } from "@/lib/analytics";
import { firstTouchFromSearchParams } from "@/lib/first-touch";

/**
 * The top of the funnel, and the denominator for every step after it.
 *
 * Renders nothing. It is mounted in `app/page.tsx` rather than inside `Landing` on purpose: the
 * landing component is a server component full of markup that other work is actively changing, and
 * the one thing this needs is a client boundary. Keeping it separate means measuring the page costs
 * the page nothing — no part of `Landing` is pulled into the browser bundle to make this work.
 *
 * The campaign parameters ride along, so a visit can be attributed even when it never becomes a
 * house. That is a different question from `groups.first_touch`, which is about the visits that DO:
 * one measures traffic, the other measures conversion, and both are wanted.
 *
 * Fires once. React invokes effects twice in development's strict mode, and a doubled top-of-funnel
 * count would halve every conversion rate on the report.
 */
export function LandingView() {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    const campaign = firstTouchFromSearchParams(new URLSearchParams(window.location.search));
    track("landing_view", { path: window.location.pathname, ...campaign });
  }, []);

  return null;
}
