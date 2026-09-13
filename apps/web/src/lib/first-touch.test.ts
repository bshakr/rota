import { describe, expect, it } from "vitest";

import {
  FIRST_TOUCH_MAX_LENGTH,
  decodeFirstTouch,
  encodeFirstTouch,
  firstTouchCookieOptions,
  firstTouchFromSearchParams,
  sanitiseFirstTouch,
} from "./first-touch";

describe("first touch", () => {
  describe("reading a landing URL", () => {
    it("takes the four UTM parameters and ref", () => {
      const params = new URLSearchParams(
        "utm_source=reddit&utm_medium=social&utm_campaign=flatshare&utm_content=comment-1&ref=member",
      );

      expect(firstTouchFromSearchParams(params)).toEqual({
        utm_source: "reddit",
        utm_medium: "social",
        utm_campaign: "flatshare",
        utm_content: "comment-1",
        ref: "member",
      });
    });

    it("ignores everything else on the query string", () => {
      const params = new URLSearchParams("utm_source=reddit&gclid=abc&email=someone%40example.com");

      expect(firstTouchFromSearchParams(params)).toEqual({ utm_source: "reddit" });
    });

    // A direct visit leaves the slot open, so the first link that CAN be attributed gets it.
    it("is null for a visit that carries no campaign at all", () => {
      expect(firstTouchFromSearchParams(new URLSearchParams(""))).toBeNull();
      expect(firstTouchFromSearchParams(new URLSearchParams("utm_source=%20%20"))).toBeNull();
    });

    it("trims and caps a value rather than dropping it" , () => {
      const params = new URLSearchParams(`utm_campaign=%20spring%20&utm_source=${"a".repeat(500)}`);

      expect(firstTouchFromSearchParams(params)).toEqual({
        utm_campaign: "spring",
        utm_source: "a".repeat(FIRST_TOUCH_MAX_LENGTH),
      });
    });
  });

  describe("the cookie", () => {
    it("round-trips a campaign through the encoding", () => {
      const value = { utm_source: "reddit", utm_campaign: "r/HousingUK, spring" };

      expect(decodeFirstTouch(encodeFirstTouch(value))).toEqual(value);
    });

    // The value is JSON, and JSON is full of cookie delimiters. Encoding is not decoration.
    it("encodes the characters that would otherwise end the Set-Cookie value early", () => {
      const encoded = encodeFirstTouch({ utm_campaign: "a,b;c" });

      expect(encoded).not.toContain(",");
      expect(encoded).not.toContain(";");
      expect(encoded).not.toContain('"');
    });

    it("reads a hand-edited or missing cookie as no campaign, never as a throw", () => {
      expect(decodeFirstTouch(undefined)).toBeNull();
      expect(decodeFirstTouch("")).toBeNull();
      expect(decodeFirstTouch("not-json")).toBeNull();
      expect(decodeFirstTouch("%E0%A4%A")).toBeNull();
      expect(decodeFirstTouch(encodeURIComponent('"a string"'))).toBeNull();
      expect(decodeFirstTouch(encodeURIComponent('{"password":"hunter2"}'))).toBeNull();
    });

    it("keeps a visitor's device free of anything a script could read", () => {
      expect(firstTouchCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    });

    // SameSite=Lax is what makes the cookie survive the trip back from WorkOS's domain. Strict
    // would drop it on exactly the request that needs it.
    it("is Lax rather than Strict, because the return journey is cross-site", () => {
      expect(firstTouchCookieOptions().sameSite).toBe("lax");
    });

    it("expires after thirty days", () => {
      expect(firstTouchCookieOptions().maxAge).toBe(60 * 60 * 24 * 30);
    });
  });

  describe("sanitising whatever arrives", () => {
    it("refuses nested documents and non-strings", () => {
      expect(sanitiseFirstTouch({ utm_source: { nested: "object" }, ref: ["a"] })).toBeNull();
      expect(sanitiseFirstTouch(null)).toBeNull();
      expect(sanitiseFirstTouch("utm_source=reddit")).toBeNull();
      expect(sanitiseFirstTouch(42)).toBeNull();
    });
  });
});
