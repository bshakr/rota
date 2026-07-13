import type { Metadata } from "next";

import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Your shifts" };

/**
 * The page every SMS points at. `[token]` is the member's permanent magic link.
 *
 * The token stays on THIS side of the wire: BLO-1055 reads it server-side and
 * forwards it to Rails as `Authorization: Bearer <token>`, never as a path
 * segment — Rails logs paths verbatim at info, and this credential does not
 * expire. See "The member auth path is a deliberate exception" in the spec.
 */
export default async function MemberShiftsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params;

  return (
    <>
      <h1 className="text-display font-heading mb-2 font-semibold">
        Your shifts
      </h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Everything coming up for you, across every rota.
      </p>
      <Placeholder ticket="BLO-1055" />
    </>
  );
}
