import { describe, expect, it, vi } from "vitest";

import type { MemberShiftsResponse } from "@/lib/api/types";

// The token-never-reaches-the-client guarantee, tested at the REAL leak vector.
//
// The static bundle grep (scripts/assert-token-not-in-bundle.mjs) proves the
// server-only client code isn't in `.next/static`. But the highest-risk leak is
// different and invisible to that grep: a Server Component passing the raw token
// as a plain prop to a Client Component, which would surface the token VALUE in
// this force-dynamic page's per-request RSC/flight payload — never written to
// `.next/static`. This renders the page server component with a sentinel token
// and asserts that value appears in no prop it hands toward the client. The token
// bound into a Server Action is a FUNCTION prop (its value lives in an encrypted
// closure, not a serialized string), so it is correctly not a leak; a raw
// `token={token}` string prop would be — and this catches exactly that.

const SENTINEL = "SENTINEL-TOKEN-a1b2c3d4e5f6-do-not-leak";

vi.mock("@/lib/api/member", () => ({
  getMemberShifts: vi.fn(),
  assignCover: vi.fn(),
  cancelCover: vi.fn(),
}));

// Stub the client list so importing the page doesn't pull client-only deps
// (sonner, radix) into the node runner. We inspect only the PROPS the page hands
// it — which is the boundary the token must not cross.
vi.mock("./shift-list", () => ({ ShiftList: () => null }));

const { getMemberShifts } = await import("@/lib/api/member");
const { default: MemberShiftsPage } = await import("./page");

const RESPONSE: MemberShiftsResponse = {
  member: { id: 1, name: "Alice Smith" },
  shifts: [
    {
      id: 100,
      rota_id: 1,
      rota_name: "Kitchen",
      due_on: "2026-07-20",
      covered: false,
      assigned_member: { id: 1, name: "Alice Smith" },
      covering_member: null,
      responsible_member: { id: 1, name: "Alice Smith" },
      can_assign_cover: true,
      can_cancel_cover: false,
    },
  ],
  coverable_members: [{ id: 2, name: "Bob" }],
};

/**
 * True if `token` appears in any string reachable from `node` — props, children,
 * nested elements, fixture objects. Functions (the bound Server Actions) and
 * symbols (`$$typeof`) are skipped: the token there lives only inside an encrypted
 * closure, which is the safe shape, not a serialized value crossing the wire.
 */
function leaks(node: unknown, token: string, seen = new Set<object>()): boolean {
  if (typeof node === "string") return node.includes(token);
  if (node === null || typeof node !== "object") return false; // number/bool/fn/symbol/bigint
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((child) => leaks(child, token, seen));
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "_owner" || key === "_store") continue; // React dev internals; can cycle
    if (leaks(value, token, seen)) return true;
  }
  return false;
}

describe("the magic-link token never reaches the client through the page render", () => {
  it("appears in no prop the page passes toward the client tree", async () => {
    vi.mocked(getMemberShifts).mockResolvedValue(RESPONSE);

    const tree = await MemberShiftsPage({ params: Promise.resolve({ token: SENTINEL }) });

    expect(leaks(tree, SENTINEL)).toBe(false);
  });

  it("the walker WOULD catch a raw-token prop (guards against a vacuous check)", () => {
    const brokenPage = { props: { token: SENTINEL, children: null } };
    expect(leaks(brokenPage, SENTINEL)).toBe(true);
  });
});
