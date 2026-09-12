import "server-only";

import { apiBaseUrl } from "./http";

export interface PublicHousehold { name: string; slug: string }

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
  const { household } = await response.json();
  // Explicit projection: even an accidental API addition cannot expose member data.
  return { name: household.name, slug: household.slug };
}

export async function requestHouseholdLink(slug: string, phone: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/public/households/${encodeURIComponent(slug)}/request_link`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }), cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Household entry unavailable");
  // Never return API data from the public mutation, especially personal-link tokens.
}
