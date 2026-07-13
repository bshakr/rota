import type { Member, Rota } from "@/lib/api/types";

// The view model the members screen renders, and the pure functions that build
// it. Kept free of `server-only`, React and env access so it unit-tests in a
// plain node runner: the page (a Server Component) reads APP_URL and calls
// `toMemberRows`; everything here is a deterministic transform of its arguments.

/** A member as the table renders them — the API shape plus the two things the row needs pre-computed. */
export interface MemberRow {
  id: number;
  name: string;
  phone_e164: string;
  active: boolean;
  /** active AND not opted out — the reminder sweep's own rule, folded server-side. */
  contactable: boolean;
  /** The rotas this member currently sits on, by name. Empty (never undefined) for nobody's rota. */
  rotaNames: string[];
  /** `${APP_URL}/s/<token>` — built server-side so the client never needs APP_URL to copy it. */
  magicLinkUrl: string;
}

export type MemberStatus = "active" | "opted_out" | "inactive";

/**
 * The one status a member row shows. Removal deactivates (`active: false`), so an
 * inactive member is a removed one; an active member who has texted STOP is
 * `active` but not `contactable` — a silently missed reminder, which is exactly
 * what this screen exists to make visible.
 */
export function memberStatus(member: Pick<Member, "active" | "contactable">): MemberStatus {
  if (!member.active) return "inactive";
  return member.contactable ? "active" : "opted_out";
}

/**
 * Which rotas each member appears in, keyed by member id, in the order the rotas
 * arrive. Only ACTIVE rotas count: a retired rota keeps its roster as history, but
 * "which rotas they appear in" is a question about the live rosters, not the past.
 */
export function rotaNamesByMemberId(rotas: Rota[]): Map<number, string[]> {
  const byMember = new Map<number, string[]>();
  for (const rota of rotas) {
    if (!rota.active) continue;
    for (const position of rota.positions) {
      const names = byMember.get(position.member_id);
      if (names) {
        names.push(rota.name);
      } else {
        byMember.set(position.member_id, [rota.name]);
      }
    }
  }
  return byMember;
}

/** `${appBaseUrl}/s/<token>`, tolerant of a trailing slash on the configured origin. */
export function buildMagicLink(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/s/${token}`;
}

/** Compose the rows the client screen renders from the two API lists and the app origin. */
export function toMemberRows(members: Member[], rotas: Rota[], appBaseUrl: string): MemberRow[] {
  const rotaNames = rotaNamesByMemberId(rotas);
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    phone_e164: member.phone_e164,
    active: member.active,
    contactable: member.contactable,
    rotaNames: rotaNames.get(member.id) ?? [],
    magicLinkUrl: buildMagicLink(appBaseUrl, member.access_token),
  }));
}
