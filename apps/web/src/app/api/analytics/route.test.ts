import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_BODY_BYTES } from "@/lib/analytics";

const { forward, configured } = vi.hoisted(() => ({
  forward: vi.fn(),
  configured: vi.fn(),
}));

vi.mock("@/lib/analytics-server", () => ({
  forwardAnalyticsEvent: forward,
  analyticsConfigured: configured,
}));

async function post(body: string | object, headers: Record<string, string> = {}) {
  // A fresh module per example, so the in-memory rate limiter starts empty and one example's burst
  // cannot 429 the next one.
  vi.resetModules();
  const { POST } = await import("./route");

  return POST(
    new Request("http://localhost:3001/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "1.1.1.1", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  forward.mockReset().mockResolvedValue(true);
  configured.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/**
 * The third argument to `forwardAnalyticsEvent` is the daily visitor code, and it is `undefined`
 * throughout the examples above: they configure no ANALYTICS_SHARED_SECRET, which is also the
 * suite's and CI's real state. Asserting it on every call is the cheap version of "nothing that
 * could name a visitor leaves this handler by accident". The block below is where the code itself
 * is the subject.
 */
function lastVisitorCode(): string | undefined {
  return forward.mock.calls.at(-1)![2];
}

describe("POST /api/analytics", () => {
  it("forwards an event the browser owns", async () => {
    const response = await post({ name: "cta_click", properties: { position: "hero" } });

    expect(response.status).toBe(204);
    expect(forward).toHaveBeenCalledWith("cta_click", { position: "hero" }, undefined);
  });

  // The boundary this route exists to hold. Anybody can post here, so accepting a house event would
  // let a stranger forge the number the whole funnel exists to measure.
  it("refuses every event that belongs to a house", async () => {
    for (const name of [
      "signin_completed",
      "house_named",
      "first_rota_saved",
      "first_member_added",
      "first_text_delivered",
      "first_member_link_opened",
      "calendar_connected",
    ]) {
      const response = await post({ name });

      expect(response.status, `${name} was accepted`).toBe(400);
    }

    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a name that is not an event at all", async () => {
    expect((await post({ name: "drop table" })).status).toBe(400);
    expect((await post({ name: 42 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON, and one that is not an object", async () => {
    expect((await post("not json at all")).status).toBe(400);
    expect((await post('"a string"')).status).toBe(400);
    expect((await post("null")).status).toBe(400);
  });

  it("keeps only allowlisted properties", async () => {
    await post({
      name: "landing_view",
      properties: { utm_source: "reddit", gclid: "abc", phone: "+447400123003" },
    });

    expect(forward).toHaveBeenCalledWith("landing_view", { utm_source: "reddit" }, undefined);
  });

  // The one property with a closed set of values, so the CTA breakdown can never grow a fourth bar
  // nobody put there.
  it("drops a CTA position it does not recognise, and keeps the event", async () => {
    await post({ name: "cta_click", properties: { position: "sidebar", ref: "member" } });

    expect(forward).toHaveBeenCalledWith("cta_click", { ref: "member" }, undefined);
  });

  it("accepts each of the three real positions", async () => {
    for (const position of ["hero", "closing", "header"]) {
      await post({ name: "cta_click", properties: { position } });

      expect(forward).toHaveBeenLastCalledWith("cta_click", { position }, undefined);
    }
  });

  // The five properties this side derives, and the one it re-checks. Everything here is really the
  // same question as the event allowlist above: can a stranger with curl decide what a chart says?
  describe("what the server adds to a visit", () => {
    it("reads the country off Cloudflare's header and the device off the client hint", async () => {
      await post(
        { name: "landing_view", properties: { path: "/" } },
        { "cf-ipcountry": "GB", "sec-ch-ua-mobile": "?1" },
      );

      expect(forward).toHaveBeenCalledWith(
        "landing_view",
        {
          path: "/",
          country: "GB",
          device: "mobile",
        },
        undefined,
      );
    });

    it("reads the city, the browser family and the system family off their own headers", async () => {
      await post(
        { name: "landing_view", properties: { path: "/" } },
        {
          "cf-ipcountry": "GB",
          "cf-ipcity": "Manchester",
          "sec-ch-ua": '"Chromium";v="141", "Google Chrome";v="141"',
          "sec-ch-ua-platform": '"macOS"',
          "sec-ch-ua-mobile": "?0",
        },
      );

      expect(forward).toHaveBeenCalledWith(
        "landing_view",
        {
          path: "/",
          country: "GB",
          city: "Manchester",
          device: "desktop",
          browser: "chrome",
          os: "macos",
        },
        undefined,
      );
    });

    // The state in production until the zone's "Add visitor location headers" transform is on. The
    // city is omitted rather than guessed at, and no lookup of our own stands in for it.
    it("omits the city while Cloudflare is not sending one", async () => {
      await post({ name: "landing_view" }, { "cf-ipcountry": "GB", "sec-ch-ua-mobile": "?0" });

      expect(forward).toHaveBeenCalledWith("landing_view", { country: "GB", device: "desktop" }, undefined);
    });

    it("drops a city that is not a name, and keeps the visit", async () => {
      await post(
        { name: "landing_view", properties: { path: "/" } },
        { "cf-ipcountry": "GB", "cf-ipcity": "12345", "sec-ch-ua-mobile": "?0" },
      );

      expect(forward).toHaveBeenCalledWith(
        "landing_view",
        {
          path: "/",
          country: "GB",
          device: "desktop",
        },
        undefined,
      );
    });

    // Nothing in front of the request that knows where it came from. The country is omitted rather
    // than guessed at, and no GeoIP lookup replaces it.
    it("omits the country when Cloudflare is not in front of the request", async () => {
      await post({ name: "landing_view" }, { "user-agent": "Mozilla/5.0 (Macintosh)" });

      expect(forward).toHaveBeenCalledWith(
        "landing_view",
        {
          device: "desktop",
          browser: "other",
          os: "macos",
        },
        undefined,
      );
    });

    it("drops Cloudflare's markers for unknown and for Tor rather than charting them", async () => {
      await post({ name: "landing_view" }, { "cf-ipcountry": "XX" });

      expect(forward).toHaveBeenCalledWith("landing_view", {}, undefined);
    });

    // The point of deriving them here. A country the browser supplied would be a country the
    // browser made up, and the traffic page's columns would be a chart of whatever a script felt
    // like claiming.
    it("refuses to take the sender's word for any of the five", async () => {
      await post(
        {
          name: "landing_view",
          properties: {
            country: "US",
            city: "Atlantis",
            device: "desktop",
            browser: "firefox",
            os: "linux",
            path: "/",
          },
        },
        {
          "cf-ipcountry": "GB",
          "cf-ipcity": "London",
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua": '"Chromium";v="141", "Google Chrome";v="141"',
          "sec-ch-ua-platform": '"Android"',
        },
      );

      expect(forward).toHaveBeenCalledWith(
        "landing_view",
        {
          path: "/",
          country: "GB",
          city: "London",
          device: "mobile",
          browser: "chrome",
          os: "android",
        },
        undefined,
      );
    });

    it("keeps a claimed property out even when it has no header of its own to use", async () => {
      await post({
        name: "landing_view",
        properties: { country: "US", city: "Atlantis", device: "tablet", browser: "safari", os: "ios" },
      });

      expect(forward).toHaveBeenCalledWith("landing_view", {}, undefined);
    });

    // The invariant the privacy page rests on. The agent string is matched for the families above
    // and goes no further: it is not stored, not logged and not forwarded, and neither is the IP the
    // rate limiter bucketed the request under.
    it("never forwards the user agent or the IP it read on the way past", async () => {
      const agent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

      await post({ name: "landing_view" }, { "user-agent": agent, "x-forwarded-for": "203.0.113.7" });

      const [, properties] = forward.mock.calls.at(-1)!;
      expect(properties).toEqual({ device: "mobile", browser: "safari", os: "ios" });
      expect(JSON.stringify(properties)).not.toMatch(/Mozilla|AppleWebKit|203\.0\.113\.7/);
    });

    it("forwards a referrer host the page derived", async () => {
      await post({ name: "landing_view", properties: { referrer_host: "news.ycombinator.com" } });

      expect(forward).toHaveBeenCalledWith(
        "landing_view",
        {
          referrer_host: "news.ycombinator.com",
        },
        undefined,
      );
    });

    // The page sends only a host. A stranger with curl did not, and a referrer table is read by a
    // person: an entry that is really a sentence somebody chose is how a dashboard becomes a
    // noticeboard.
    it("drops a referrer that is a whole URL or a sentence, and keeps the event", async () => {
      await post({
        name: "landing_view",
        properties: { referrer_host: "https://reddit.com/r/uk?q=secret", path: "/" },
      });

      expect(forward).toHaveBeenCalledWith("landing_view", { path: "/" }, undefined);
    });
  });

  /**
   * How this site counts VISITORS without a cookie: a hash of the address and the agent with a salt
   * that changes at midnight UTC. Every example here is really one of two questions — does the same
   * browser get the same code today, and is yesterday's code unrecoverable tomorrow?
   */
  describe("the daily visitor code", () => {
    const secret = "a-shared-secret";
    const agent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const visitor = { "x-forwarded-for": "203.0.113.7", "user-agent": agent };
    const onAnIphone = { device: "mobile", browser: "safari", os: "ios" };

    beforeEach(() => {
      vi.stubEnv("ANALYTICS_SHARED_SECRET", secret);
    });

    it("sends sixty-four characters of hex with a landing view", async () => {
      await post({ name: "landing_view" }, visitor);

      expect(lastVisitorCode()).toMatch(/^[0-9a-f]{64}$/);
    });

    // A cta_click happens on a page whose visit was already counted, and putting the same code on
    // three rows of one visit would build exactly the join this table exists not to have.
    it("sends none with the other two events the browser owns", async () => {
      for (const name of ["cta_click", "signin_started"]) {
        await post({ name, properties: { position: "hero" } }, visitor);

        expect(lastVisitorCode(), `${name} carried a visitor code`).toBeUndefined();
      }
    });

    it("sends none when no shared secret is configured, and forwards the visit anyway", async () => {
      vi.stubEnv("ANALYTICS_SHARED_SECRET", "");

      const response = await post({ name: "landing_view" }, visitor);

      expect(response.status).toBe(204);
      expect(forward).toHaveBeenCalledWith("landing_view", onAnIphone, undefined);
    });

    // Without an address there is no visitor to be the same as. A shared code for every request
    // with no proxy header in front of it would count them all as one browser, which is a made-up
    // number rather than a missing one.
    it("sends none when nothing in front of the request reported an address", async () => {
      vi.resetModules();
      const { POST } = await import("./route");
      await POST(
        new Request("http://localhost:3001/api/analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json", "user-agent": agent },
          body: JSON.stringify({ name: "landing_view" }),
        }),
      );

      expect(lastVisitorCode()).toBeUndefined();
    });

    it("gives one browser the same code twice in a day", async () => {
      await post({ name: "landing_view" }, visitor);
      const first = lastVisitorCode();

      await post({ name: "landing_view", properties: { path: "/" } }, visitor);

      expect(lastVisitorCode()).toBe(first);
    });

    it("gives a different address and a different agent different codes", async () => {
      await post({ name: "landing_view" }, visitor);
      const first = lastVisitorCode();

      await post({ name: "landing_view" }, { ...visitor, "x-forwarded-for": "203.0.113.8" });
      const otherAddress = lastVisitorCode();

      await post({ name: "landing_view" }, { ...visitor, "user-agent": "Mozilla/5.0 (Linux; Android 15)" });

      expect(otherAddress).not.toBe(first);
      expect(lastVisitorCode()).not.toBe(first);
      expect(lastVisitorCode()).not.toBe(otherAddress);
    });

    // THE reason there is no "returning visitors" figure in this product. The salt is derived from
    // the UTC date and nothing keeps a copy of it, so a code from one day cannot be recomputed on
    // the next by us or by anybody holding the table.
    it("gives one browser a different code either side of midnight UTC", async () => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2026-09-15T23:59:00.000Z"));
      await post({ name: "landing_view" }, visitor);
      const before = lastVisitorCode();

      vi.setSystemTime(new Date("2026-09-16T00:01:00.000Z"));
      await post({ name: "landing_view" }, visitor);

      expect(before).toMatch(/^[0-9a-f]{64}$/);
      expect(lastVisitorCode()).not.toBe(before);
    });

    // The invariant that keeps it out of a row. It travels in a header (see analytics-server.ts),
    // and nothing that went into it is in the properties either.
    it("keeps the code, the address and the agent out of the properties", async () => {
      await post({ name: "landing_view", properties: { path: "/" } }, visitor);

      const [, properties, code] = forward.mock.calls.at(-1)!;
      expect(properties).toEqual({ path: "/", ...onAnIphone });
      expect(JSON.stringify(properties)).not.toContain(code);
      expect(JSON.stringify(properties)).not.toMatch(/Mozilla|203\.0\.113\.7/);
    });
  });

  describe("abuse limits", () => {
    it("refuses a body over 2 KB, by its declared size", async () => {
      const response = await post({ name: "landing_view" }, { "content-length": String(MAX_BODY_BYTES + 1) });

      expect(response.status).toBe(413);
      expect(forward).not.toHaveBeenCalled();
    });

    it("refuses a body over 2 KB that lied about its size", async () => {
      const padded = JSON.stringify({ name: "landing_view", padding: "a".repeat(MAX_BODY_BYTES) });

      const response = await post(padded, { "content-length": "10" });

      expect(response.status).toBe(413);
      expect(forward).not.toHaveBeenCalled();
    });

    it("rate-limits one caller without touching another", async () => {
      vi.resetModules();
      const { POST } = await import("./route");
      const send = (ip: string) =>
        POST(
          new Request("http://localhost:3001/api/analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
            body: JSON.stringify({ name: "landing_view" }),
          }),
        );

      const statuses: number[] = [];
      for (let i = 0; i < 25; i += 1) statuses.push((await send("9.9.9.9")).status);

      expect(statuses.filter((status) => status === 204)).toHaveLength(20);
      expect(statuses.filter((status) => status === 429)).toHaveLength(5);
      expect((await send("8.8.8.8")).status).toBe(204);
    });
  });

  // A deploy with no analytics configured is not the visitor's problem, and a failure to forward
  // must never surface as an error in somebody's console.
  it("answers 204 and forwards nothing when no shared secret is configured", async () => {
    configured.mockReturnValue(false);

    const response = await post({ name: "landing_view" });

    expect(response.status).toBe(204);
    expect(forward).not.toHaveBeenCalled();
  });

  it("answers 204 even when Rails refuses the event", async () => {
    forward.mockResolvedValue(false);

    expect((await post({ name: "landing_view" })).status).toBe(204);
  });
});
