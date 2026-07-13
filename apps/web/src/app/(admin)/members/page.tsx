import type { Metadata } from "next";

import { listMembers, listRotas } from "@/lib/api/admin";

import { toMemberRows } from "./data";
import { MembersScreen } from "./members-screen";

export const metadata: Metadata = { title: "Members" };

// APP_URL is the public origin a member's magic link points at. It is read here,
// on the server, and never re-exported into the client bundle (see next.config.ts)
// — so the full link is built server-side and handed down ready to copy, and the
// browser never needs the app origin to render the screen.
function appBaseUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error(
      "APP_URL is not set — the members screen can't build magic links. Set it in the repo-root .env (see .env.example).",
    );
  }
  return url;
}

export default async function MembersPage() {
  // Both lists in one round trip: members carry the person, rotas carry which
  // rosters each person sits on. A thrown ApiError falls through to error.tsx;
  // a 401 re-auths inside the admin client before it ever gets here.
  const [members, rotas] = await Promise.all([listMembers(), listRotas()]);
  const rows = toMemberRows(members.members, rotas.rotas, appBaseUrl());

  return <MembersScreen members={rows} />;
}
