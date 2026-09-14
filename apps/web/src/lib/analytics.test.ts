import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_EVENTS,
  BROWSER_EVENTS,
  CTA_POSITIONS,
  MAX_BODY_BYTES,
  MAX_PROPERTY_LENGTH,
  PROPERTY_KEYS,
  isBrowserEvent,
  sanitiseProperties,
  track,
} from "./analytics";

describe("the event list", () => {
  it("is the ten steps of the funnel, and nothing else", () => {
    expect([...ANALYTICS_EVENTS]).toEqual([
      "landing_view",
      "cta_click",
      "signin_started",
      "signin_completed",
      "house_named",
      "first_rota_saved",
      "first_member_added",
      "first_text_delivered",
      "first_member_link_opened",
      "calendar_connected",
    ]);
  });

  // The boundary, stated as a test. A browser can post to /api/analytics, so if it could send
  // `first_text_delivered` then anybody could forge the number the whole funnel exists to measure.
  it("lets the browser send only the three events that happen before a house exists", () => {
    expect([...BROWSER_EVENTS]).toEqual(["landing_view", "cta_click", "signin_started"]);

    expect(isBrowserEvent("cta_click")).toBe(true);
    expect(isBrowserEvent("first_text_delivered")).toBe(false);
    expect(isBrowserEvent("house_named")).toBe(false);
    expect(isBrowserEvent("signin_completed")).toBe(false);
    expect(isBrowserEvent("")).toBe(false);
    expect(isBrowserEvent(null)).toBe(false);
  });
});

// Two allowlists, two languages, one meaning. A rename on one side and not the other would not fail
// a type check or a Ruby spec; it would quietly drop events at the endpoint and nobody would notice
// until a chart was empty. This is the only thing that catches it.
describe("the Rails allowlist", () => {
  const model = readFileSync(
    fileURLToPath(new URL("../../../api/app/models/analytics_event.rb", import.meta.url)),
    "utf8",
  );

  function rubyList(constant: string): string[] {
    const body = model.match(new RegExp(`${constant} = %w\\[([^\\]]*)\\]`))?.[1];
    return body ? body.trim().split(/\s+/) : [];
  }

  it("agrees on every property key", () => {
    expect(rubyList("PROPERTY_KEYS")).toEqual([...PROPERTY_KEYS]);
  });

  it("agrees on the CTA positions", () => {
    expect(rubyList("CTA_POSITIONS")).toEqual([...CTA_POSITIONS]);
  });

  it("agrees on the maximum property length", () => {
    expect(model).toContain(`MAX_VALUE_LENGTH = ${MAX_PROPERTY_LENGTH}`);
  });

  it("defines every one of the ten event names", () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(model).toContain(`= "${event}"`);
    }
  });
});

describe("sanitiseProperties", () => {
  it("keeps only the allowlisted keys", () => {
    expect(sanitiseProperties({ utm_source: "reddit", gclid: "abc", email: "someone@example.com" }))
      .toEqual({ utm_source: "reddit" });
  });

  it("trims and caps a string rather than dropping the event that carried it", () => {
    expect(sanitiseProperties({ utm_campaign: "  spring  ", utm_source: "a".repeat(500) }))
      .toEqual({ utm_campaign: "spring", utm_source: "a".repeat(MAX_PROPERTY_LENGTH) });
  });

  it("keeps whole numbers and booleans, and discards everything else", () => {
    expect(sanitiseProperties({ member_id: 42 })).toEqual({ member_id: 42 });
    expect(sanitiseProperties({ member_id: 1.5 })).toEqual({});
    expect(sanitiseProperties({ utm_source: { nested: "object" }, ref: ["a"] })).toEqual({});
  });

  it("drops a blank rather than storing an empty string", () => {
    expect(sanitiseProperties({ utm_source: "   ", ref: "member" })).toEqual({ ref: "member" });
  });

  it("reads anything that is not an object as no properties at all", () => {
    expect(sanitiseProperties(null)).toEqual({});
    expect(sanitiseProperties("utm_source=reddit")).toEqual({});
    expect(sanitiseProperties(undefined)).toEqual({});
  });
});

describe("track", () => {
  const sendBeacon = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    sendBeacon.mockReset().mockReturnValue(true);
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function beaconBody(): Promise<unknown> {
    return JSON.parse(await (sendBeacon.mock.calls[0][1] as Blob).text());
  }

  it("posts the event to our own origin, and never to anybody else's", async () => {
    track("cta_click", { position: "hero" });

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/analytics");
    expect(await beaconBody()).toEqual({ name: "cta_click", properties: { position: "hero" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A CTA click navigates away. sendBeacon is what survives the page being torn down.
  it("prefers sendBeacon and falls back to keepalive fetch when the browser refuses it", () => {
    sendBeacon.mockReturnValue(false);

    track("landing_view", { path: "/" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/analytics");
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(init.body)).toEqual({ name: "landing_view", properties: { path: "/" } });
  });

  it("falls back when the browser has no sendBeacon at all", () => {
    vi.stubGlobal("navigator", {});

    track("signin_started");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("strips a property that is not on the allowlist before it ever leaves the page", async () => {
    track("landing_view", { utm_source: "reddit", phone: "+447400123003" } as never);

    expect(await beaconBody()).toEqual({ name: "landing_view", properties: { utm_source: "reddit" } });
  });

  it("sends nothing at all on the server, where there is no page to measure", () => {
    vi.stubGlobal("window", undefined);

    track("landing_view");

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // `track` carries no size check, because sanitising already bounds the payload. This is the
  // assertion that keeps that true: if the property allowlist ever grows past what the endpoint
  // accepts, this fails rather than events silently starting to bounce with a 413.
  it("cannot build a body the endpoint would refuse, even with every property at full length", async () => {
    const atCap = "a".repeat(MAX_PROPERTY_LENGTH * 2);
    const stuffed = Object.fromEntries(PROPERTY_KEYS.map((key) => [key, atCap]));

    track("landing_view", stuffed as never);

    const body = JSON.stringify(await beaconBody());
    expect(new TextEncoder().encode(body).length).toBeLessThan(MAX_BODY_BYTES);
  });

  // A measurement must never be the thing that breaks a page.
  it("swallows a browser that throws from sendBeacon", () => {
    sendBeacon.mockImplementation(() => {
      throw new Error("blocked by an extension");
    });

    expect(() => track("cta_click", { position: "closing" })).not.toThrow();
  });

  it("swallows a fetch that rejects", () => {
    sendBeacon.mockReturnValue(false);
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(() => track("landing_view")).not.toThrow();
  });
});
