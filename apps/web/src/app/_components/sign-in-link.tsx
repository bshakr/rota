"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";

import { track, type CtaPosition } from "@/lib/analytics";
import { SIGN_IN_HREF } from "@/lib/site";

/**
 * A landing-page call to action, measured.
 *
 * It renders the same plain `<a>` the page has always rendered, with the same attributes, the same
 * class and the same children. All it adds is an `onClick`, which puts nothing in the HTML. The
 * before/after capture is byte-identical, and that is the whole claim.
 *
 * NOTHING here can delay or block the navigation. No `preventDefault`, no `await`, no promise the
 * browser waits on: `track` hands the event to `navigator.sendBeacon`, which the browser delivers
 * even as it tears the page down, and falls back to `fetch` with `keepalive`. A click that led to a
 * slower sign-in would be a worse trade than losing the measurement.
 *
 * This is the smallest possible client boundary. It wraps one anchor rather than the `Landing` tree,
 * and its children arrive already rendered on the server, so measuring the page pulls none of the
 * page into the browser bundle. It costs no new boundary at all in practice: `Button asChild`
 * already renders through Radix's `Slot`, which is a client component, so this subtree was on the
 * client before it was measured.
 *
 * Two events, because a press of one of these is two facts. `cta_click` says which of the three
 * calls to action a visitor chose; `signin_started` says the hand-off to WorkOS began. Today every
 * CTA on the page points at `/dashboard`, so the two always coincide — but the second is derived
 * from the href rather than assumed, so a CTA that one day points somewhere else (a demo, a pricing
 * page) will stop claiming a sign-in it never started.
 */
export function SignInLink({
  position,
  onClick,
  ...props
}: { position: CtaPosition } & ComponentPropsWithoutRef<"a">) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    track("cta_click", { position });
    if (props.href === SIGN_IN_HREF) track("signin_started", { position });

    // `Button asChild` composes handlers through Slot, so anything the button wanted to do on click
    // still happens. Called last, and never conditionally: measurement must not change behaviour.
    onClick?.(event);
  }

  return <a {...props} onClick={handleClick} />;
}
