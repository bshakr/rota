import "server-only";

import { apiBaseUrl } from "./http";

export interface PublicHousehold {
  name: string;
  slug: string;
  /**
   * Is this house paused? (https://linear.app/bloombase/issue/BLO-1675)
   *
   * The API sends a top-level `"paused": true` if and only if the house is
   * suspended, and never sends it as false, so absence is the answer for a live
   * house. It is projected into a real boolean here because every caller wants
   * the question answered rather than the key's presence inspected.
   *
   * The house's NAME still arrives, deliberately — the page has to be able to say
   * which house is paused. `POST …/request_link` is unchanged on the surface: it
   * still answers 202 and simply queues nothing, so a paused house is answered
   * exactly as an unknown one is and the endpoint goes on saying nothing about
   * either the house or the number.
   */
  paused: boolean;
}

export function validHouseholdSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export async function getPublicHousehold(slug: string): Promise<PublicHousehold | null> {
  if (!validHouseholdSlug(slug)) return null;
  const response = await fetch(`${apiBaseUrl()}/public/households/${encodeURIComponent(slug)}`, {
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Household lookup unavailable");
  const body = await response.json();
  const { household } = body;
  // Explicit projection: even an accidental API addition cannot expose member data.
  // `paused` is read strictly (`=== true`) for the same reason it is in
  // ./paused.ts: this is an untyped body at the edge, and a truthiness test would
  // let a stray value switch a working house off on screen.
  return { name: household.name, slug: household.slug, paused: body.paused === true };
}

export async function requestHouseholdLink(slug: string, phone: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/public/households/${encodeURIComponent(slug)}/request_link`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }), cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Household entry unavailable");
  // Never return API data from the public mutation, especially personal-link tokens.
}
