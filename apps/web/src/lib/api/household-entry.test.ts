import { beforeEach, expect, it, vi } from "vitest";
import { getPublicHousehold } from "./household-entry";

beforeEach(() => { vi.stubEnv("API_URL", "http://api.test"); vi.stubGlobal("fetch", vi.fn()); });

it("projects household identification only", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ household: { name: "Park Vista", slug: "park-vista", members: [{ access_token: "private" }] } })));
  expect(await getPublicHousehold("park-vista")).toEqual({ name: "Park Vista", slug: "park-vista", paused: false });
});

// The paused shape (https://linear.app/bloombase/issue/BLO-1675): a top-level
// flag, present only when the house is suspended, beside the household it still
// names — so the page can say WHICH house is resting.
it("reads the paused flag, and only a literal true", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ household: { name: "Park Vista", slug: "park-vista" }, paused: true })));
  expect(await getPublicHousehold("park-vista")).toEqual({ name: "Park Vista", slug: "park-vista", paused: true });

  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ household: { name: "Park Vista", slug: "park-vista" }, paused: "true" })));
  expect(await getPublicHousehold("park-vista")).toMatchObject({ paused: false });
});

it("returns null for unknown houses", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));
  expect(await getPublicHousehold("missing")).toBeNull();
});

it("does not fetch unsafe slugs", async () => {
  expect(await getPublicHousehold("../members")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
