import { describe, expect, it } from "vitest";

import { createTokenBucket } from "./rate-limit";

describe("the token bucket", () => {
  function bucketAt(clock: { now: number }, options = {}) {
    return createTokenBucket({ capacity: 3, refillPerSecond: 1, now: () => clock.now, ...options });
  }

  it("allows a burst up to the capacity, then refuses", () => {
    const clock = { now: 0 };
    const limiter = bucketAt(clock);

    expect([limiter.take("1.1.1.1"), limiter.take("1.1.1.1"), limiter.take("1.1.1.1")]).toEqual([
      true, true, true,
    ]);
    expect(limiter.take("1.1.1.1")).toBe(false);
  });

  // Continuous refill rather than a window that resets, so a quiet caller gets their allowance back
  // and a hammering one gets a steady trickle, instead of everyone racing for the same second.
  it("refills over time rather than on a window boundary", () => {
    const clock = { now: 0 };
    const limiter = bucketAt(clock);

    for (let i = 0; i < 3; i += 1) limiter.take("1.1.1.1");
    expect(limiter.take("1.1.1.1")).toBe(false);

    clock.now = 1_000;
    expect(limiter.take("1.1.1.1")).toBe(true);
    expect(limiter.take("1.1.1.1")).toBe(false);
  });

  it("never refills past the capacity, however long the caller was away", () => {
    const clock = { now: 0 };
    const limiter = bucketAt(clock);

    limiter.take("1.1.1.1");
    clock.now = 60 * 60 * 1000;

    expect([limiter.take("1.1.1.1"), limiter.take("1.1.1.1"), limiter.take("1.1.1.1")]).toEqual([
      true, true, true,
    ]);
    expect(limiter.take("1.1.1.1")).toBe(false);
  });

  it("gives every caller their own bucket" , () => {
    const clock = { now: 0 };
    const limiter = bucketAt(clock);

    for (let i = 0; i < 3; i += 1) limiter.take("1.1.1.1");

    expect(limiter.take("1.1.1.1")).toBe(false);
    expect(limiter.take("2.2.2.2")).toBe(true);
  });

  // An unbounded map keyed on client IP is a memory leak with a rude name.
  it("evicts the least recently seen caller rather than growing without limit", () => {
    const clock = { now: 0 };
    const limiter = bucketAt(clock, { maxKeys: 2 });

    limiter.take("first");
    limiter.take("second");
    limiter.take("third");

    expect(limiter.size()).toBe(2);
  });

  it("keeps a caller who is still active when it evicts", () => {
    const clock = { now: 0 };
    const limiter = bucketAt(clock, { maxKeys: 2 });

    limiter.take("busy");
    limiter.take("quiet");
    limiter.take("busy");
    limiter.take("newcomer");

    // "quiet" was the least recently seen, so it is the one that went.
    expect(limiter.size()).toBe(2);
    for (let i = 0; i < 2; i += 1) limiter.take("busy");
    expect(limiter.take("busy")).toBe(false);
  });
});
