import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { GROUP_SUSPENDED, isGroupSuspended, isPaused, pausedHouseName } from "./paused";

// The paused shape, both spellings, asserted against the table in
// https://github.com/bshakr/rota/pull/52 — the API side of
// https://linear.app/bloombase/issue/BLO-1675.

describe("the code Rails refuses with", () => {
  // Hardcoded rather than imported, on purpose: this string is a contract with
  // Ruby (`Authenticatable#refuse_suspended_group`), and a test that reads it
  // from the same constant the code reads it from proves nothing about the wire.
  it("is the string the API sends", () => {
    expect(GROUP_SUSPENDED).toBe("group_suspended");
  });
});

describe("isGroupSuspended", () => {
  it("recognises the house admin refusal", () => {
    expect(isGroupSuspended(new ApiError(403, { error: "group_suspended" }))).toBe(true);
  });

  it("recognises the cover refusal, which carries a message too", () => {
    const error = new ApiError(403, {
      error: "group_suspended",
      message: "This house is paused, so shifts can't be handed over right now.",
    });
    expect(isGroupSuspended(error)).toBe(true);
  });

  // The CODE and not the status. A 403 for another reason entirely must not
  // render a paused screen over a house that is running perfectly well.
  it("is not satisfied by any other 403", () => {
    expect(isGroupSuspended(new ApiError(403, { error: "forbidden" }))).toBe(false);
  });

  it("is false for every other failure, so a catch can re-throw the rest", () => {
    expect(isGroupSuspended(new ApiError(401, { error: "unauthorized" }))).toBe(false);
    expect(isGroupSuspended(new ApiError(404, { error: "not_found" }))).toBe(false);
    expect(isGroupSuspended(new Error("fetch failed"))).toBe(false);
    expect(isGroupSuspended(null)).toBe(false);
    expect(isGroupSuspended("group_suspended")).toBe(false);
  });
});

describe("isPaused", () => {
  it("reads the member path's replacement payload", () => {
    expect(isPaused({ paused: true, house: { name: "Alma Road" } })).toBe(true);
  });

  it("reads the household entry page's top-level flag", () => {
    expect(isPaused({ household: { name: "Alma Road", slug: "alma-road" }, paused: true })).toBe(
      true,
    );
  });

  // The rule the whole shape rests on: `paused` is present if and only if the
  // house is suspended, and is never sent as false. A live payload simply has no
  // such key.
  it("is false for a live payload, which carries no paused key at all", () => {
    expect(isPaused({ today: "2026-09-14", shifts: [] })).toBe(false);
    expect(isPaused({ household: { name: "Alma Road", slug: "alma-road" } })).toBe(false);
  });

  // Strictly `=== true`. A truthy test would let a stray value replace a working
  // rota with a notice saying the house has been switched off.
  it("refuses anything that is merely truthy", () => {
    expect(isPaused({ paused: "true" } as unknown as { paused: true })).toBe(false);
    expect(isPaused({ paused: 1 } as unknown as { paused: true })).toBe(false);
    expect(isPaused({ paused: false } as unknown as { paused: true })).toBe(false);
  });
});

describe("pausedHouseName", () => {
  it("gives the name the member path carries", () => {
    expect(pausedHouseName({ paused: true, house: { name: "Alma Road" } })).toBe("Alma Road");
  });

  // The household entry page keeps its own `household` key instead, so this
  // answers null and the page falls back to what it already knew.
  it("answers null when the payload carried no house", () => {
    expect(pausedHouseName({ paused: true })).toBeNull();
  });
});
