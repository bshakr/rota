import type { Metadata } from "next";
import { CloudOff } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { HousePaused } from "@/components/house-paused";
import { InvalidLink } from "@/components/member/invalid-link";
import { apiErrorMessage, isApiError } from "@/lib/api/errors";
import { getMemberSchedule } from "@/lib/api/member";
import { isPaused, pausedHouseName } from "@/lib/api/paused";
import { formatLongDate } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";

import { assignCoverAction, cancelCoverAction } from "./actions";
import { MemberFeed } from "./member-feed";

export const metadata: Metadata = {
  title: "Your rota",
  // A magic link is a per-person credential; it must never be crawled or cached
  // by a search engine that followed a leaked URL.
  robots: { index: false, follow: false },
};

// Live, per-request: this reads a per-member credential and must never be
// statically prerendered or cached across members.
export const dynamic = "force-dynamic";

// A plain <a>, and the href hoisted into a constant, for the two reasons every link
// home in this app shares. A full page load rather than a <Link>: somebody leaving
// their rota for the marketing site should land on a fresh document, not a client-side
// transition that carries the member layout's router state with it, and `/` redirects a
// signed-in admin onward anyway. The constant is what keeps
// @next/next/no-html-link-for-pages quiet about a deliberate choice, exactly as
// landing.tsx does with SIGN_IN_HREF.
const HOME_HREF = "/?ref=member";

/**
 * The page every SMS points at. `[token]` is the member's permanent magic link.
 *
 * The token is read here, in a Server Component (`await params`), and forwarded to
 * Rails only as `Authorization: Bearer <token>` by the `server-only` member client —
 * never as a path segment (Rails logs paths verbatim at info, and this credential does
 * not expire). No Client Component receives it as a data prop, and none of the member
 * API client reaches `.next/static`; both are asserted, by page.token-safety.test.ts
 * and by scripts/assert-token-not-in-bundle.mjs.
 *
 * The two cover mutations are bound to it here and handed down as opaque action
 * references. Be precise about what that buys: Next encrypts a CLOSED-OVER variable,
 * not a `.bind()` argument, so the token is serialised in plain text into THIS
 * request's flight payload. That payload is only ever the answer to a request that
 * already carried the token in its URL, so it is not an escalation — but the guarantee
 * is "never in a shared bundle, never in a logged path", not "these bytes never reach
 * the browser".
 */
export default async function MemberSchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let schedule;
  try {
    schedule = await getMemberSchedule(token);
  } catch (error) {
    // A bad, rotated or deactivated token authenticates as nobody: 401. Show the
    // kind, blameless dead-link page — no stack trace, no "404", no hint about why.
    if (isApiError(error) && error.status === 401) {
      return <InvalidLink />;
    }
    // A throttle (429) or a brief outage (5xx) is not a broken link. Show warm,
    // human copy from the shared error map — never a code — and keep the member
    // surface, rather than falling through to the app-wide error boundary.
    if (isApiError(error)) {
      return (
        <EmptyState
          icon={CloudOff}
          title="We couldn't load your rota"
          description={apiErrorMessage(error, "This one's on us, not you. Try again in a moment.")}
        />
      );
    }
    // Truly unexpected (the API host unreachable, so fetch rejected before Rails
    // answered): let the error boundary show its warm "try again".
    throw error;
  }

  // A suspended house answers 200 with the paused shape instead of the rota
  // (https://linear.app/bloombase/issue/BLO-1675), so this is not an error path
  // and must not look like one. There is no feed, which is also how the hand-off
  // action disappears: a cover is a write, the API refuses it outright, and an
  // offer to hand over a turn that cannot be handed over would be a lie on the
  // one screen a housemate actually reads.
  if (isPaused(schedule)) {
    return <HousePaused name={pausedHouseName(schedule)} />;
  }

  const firstName = schedule.member.name.split(" ")[0];

  return (
    <>
      {/* The greeting. Fredoka, pressed wide, with a peach clay dot for a full
          stop: the whole flourish is one sticker, no swash and no gradient,
          because this should read like a note left on the fridge rather than a
          dashboard heading. The date under it is the GROUP's today, the same one
          every relative day on this page is measured from. */}
      <div className="animate-rise mb-6">
        <h1 className="text-display font-heading text-pretty">
          Hi {firstName}
          <span
            className="bg-peach shadow-xs ml-2 inline-block size-3 rounded-full align-middle"
            aria-hidden
          />
        </h1>
        <p className="text-muted-foreground mt-3 text-[0.9375rem] text-pretty">
          {formatLongDate(civilDate(schedule.today))}. Here&apos;s what the whole house is up to.
        </p>
      </div>

      <MemberFeed
        schedule={schedule}
        assignAction={assignCoverAction.bind(null, token)}
        cancelAction={cancelCoverAction.bind(null, token)}
      />

      {/* This page is the only Rota Monster most housemates have ever seen: they were
          added by somebody else and never visited the site. The line is addressed to
          somebody who already HAS a rota, so it asks them to pass the name on rather
          than to set one up for themselves. The domain is the link because the domain
          is the thing worth remembering. `?ref=member` tells the homepage where they
          came from. Deliberately not a button: nobody opened their rota in order to
          leave it. */}
      <p className="text-muted-foreground mt-10 text-center text-sm text-pretty">
        Got a friend who needs a rota? Share{" "}
        <a href={HOME_HREF} className="underline underline-offset-4">
          rota.monster
        </a>{" "}
        with them.
      </p>
    </>
  );
}
