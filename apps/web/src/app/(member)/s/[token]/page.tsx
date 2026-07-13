import type { Metadata } from "next";

import { InvalidLink } from "@/components/member/invalid-link";
import { isApiError } from "@/lib/api/errors";
import { getMemberShifts } from "@/lib/api/member";

import { assignCoverAction, cancelCoverAction } from "./actions";
import { ShiftList } from "./shift-list";

export const metadata: Metadata = {
  title: "Your shifts",
  // A magic link is a per-person credential; it must never be crawled or cached
  // by a search engine that followed a leaked URL.
  robots: { index: false, follow: false },
};

// Live, per-request: this reads a per-member credential and must never be
// statically prerendered or cached across members.
export const dynamic = "force-dynamic";

/**
 * The page every SMS points at. `[token]` is the member's permanent magic link.
 *
 * The token stays on THIS side of the wire: it is read here, in a Server Component
 * (`await params`), and forwarded to Rails only as `Authorization: Bearer <token>`
 * by the `server-only` member client — never as a path segment (Rails logs paths
 * verbatim at info, and this credential does not expire). It reaches the client
 * nowhere as a value: the two cover mutations are bound to it here and handed to
 * the list as opaque actions, so the browser gets the actions, not the token.
 */
export default async function MemberShiftsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let data;
  try {
    data = await getMemberShifts(token);
  } catch (error) {
    // A bad, rotated or deactivated token authenticates as nobody: 401. Show the
    // kind, blameless dead-link page — no stack trace, no "404", no hint about why.
    if (isApiError(error) && error.status === 401) {
      return <InvalidLink />;
    }
    // Anything else (the API briefly unreachable) is a real fault; let the error
    // boundary show its warm "this one's on us, try again".
    throw error;
  }

  const firstName = data.member.name.split(" ")[0];

  return (
    <>
      <h1 className="text-display font-heading mb-1 font-semibold">Hi {firstName}</h1>
      <p className="text-muted-foreground mb-8 text-sm text-pretty">
        Here&apos;s what&apos;s coming up for you, across every rota.
      </p>

      <ShiftList
        initialShifts={data.shifts}
        coverableMembers={data.coverable_members}
        memberId={data.member.id}
        today={data.today}
        assignAction={assignCoverAction.bind(null, token)}
        cancelAction={cancelCoverAction.bind(null, token)}
      />
    </>
  );
}
