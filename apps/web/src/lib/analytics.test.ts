import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_EVENTS,
  BROWSER_EVENTS,
  BROWSER_PROPERTY_KEYS,
  CTA_POSITIONS,
  DEVICE_CLASSES,
  MAX_BODY_BYTES,
  MAX_PROPERTY_LENGTH,
  PROPERTY_KEYS,
  isBrowserEvent,
  isHostname,
  referrerHost,
  sanitiseBrowserProperties,
  sanitiseProperties,
  track,
  visitContext,
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

  it("agrees on the three device classes", () => {
    expect(rubyList("DEVICE_CLASSES")).toEqual([...DEVICE_CLASSES]);
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

// The boundary that keeps the country and device columns worth reading. A value a visitor could
// choose is a value that says nothing, so the browser list simply does not contain them and a body
// carrying one loses it on the way through rather than being deleted afterwards.
describe("sanitiseBrowserProperties", () => {
  it("has no country and no device on it at all", () => {
    expect([...BROWSER_PROPERTY_KEYS]).not.toContain("country");
    expect([...BROWSER_PROPERTY_KEYS]).not.toContain("device");
  });

  it("drops a country and a device the sender supplied, and keeps the rest", () => {
    expect(
      sanitiseBrowserProperties({ utm_source: "reddit", country: "US", device: "desktop" }),
    ).toEqual({ utm_source: "reddit" });
  });

  it("keeps the referrer host, which the browser does own", () => {
    expect(sanitiseBrowserProperties({ referrer_host: "reddit.com" })).toEqual({
      referrer_host: "reddit.com",
    });
  });
});

describe("isHostname", () => {
  it("accepts a host, with or without the port URL.host leaves on", () => {
    expect(isHostname("news.ycombinator.com")).toBe(true);
    expect(isHostname("localhost:3001")).toBe(true);
    expect(isHostname("a-b.co.uk")).toBe(true);
  });

  it("refuses a whole URL, a sentence, and a label that starts or ends in a hyphen", () => {
    expect(isHostname("https://reddit.com/r/uk?q=me@example.com")).toBe(false);
    expect(isHostname("look at this")).toBe(false);
    expect(isHostname("-leading.com")).toBe(false);
    expect(isHostname("trailing-.com")).toBe(false);
    expect(isHostname("")).toBe(false);
  });

  it("refuses a host longer than the column will hold", () => {
    expect(isHostname(`${"a".repeat(MAX_PROPERTY_LENGTH)}.com`)).toBe(false);
  });
});

describe("referrerHost", () => {
  const origin = "https://rota.monster";

  // The path and the query never leave the page. A referring URL is exactly where somebody's search
  // terms or their email address would be; a host cannot hold either.
  it("keeps the host and nothing else from the referring URL", () => {
    expect(referrerHost("https://www.google.com/search?q=chore+rota+for+my+flat", origin)).toBe(
      "www.google.com",
    );
  });

  it("lowercases it, so one referrer cannot draw two bars", () => {
    expect(referrerHost("https://Reddit.COM/r/uk", origin)).toBe("reddit.com");
  });

  it("says nothing for a direct visit", () => {
    expect(referrerHost("", origin)).toBeUndefined();
  });

  // A housemate clicking through the site is not a source of traffic, and counting them would put
  // Rota Monster at the top of its own referrer table.
  it("says nothing when the referrer is one of our own pages", () => {
    expect(referrerHost("https://rota.monster/privacy", origin)).toBeUndefined();
  });

  it("says nothing for a referrer that is not a URL at all", () => {
    expect(referrerHost("not a url", origin)).toBeUndefined();
    expect(referrerHost("about:blank", origin)).toBeUndefined();
  });
});

describe("visitContext", () => {
  function headers(values: Record<string, string>): Headers {
    return new Headers(values);
  }

  it("reads the country from Cloudflare's header, uppercased", () => {
    expect(visitContext(headers({ "cf-ipcountry": "gb" }))).toMatchObject({ country: "GB" });
  });

  // The domain is DNS-only on Cloudflare today, so this is the state in production right now: no
  // header, no country, and no guess in its place.
  it("omits the country entirely when the header is not there", () => {
    expect(visitContext(headers({}))).not.toHaveProperty("country");
  });

  it("drops Cloudflare's own markers for unknown and for Tor", () => {
    expect(visitContext(headers({ "cf-ipcountry": "XX" }))).not.toHaveProperty("country");
    expect(visitContext(headers({ "cf-ipcountry": "T1" }))).not.toHaveProperty("country");
    expect(visitContext(headers({ "cf-ipcountry": "GBR" }))).not.toHaveProperty("country");
  });

  it("reads a phone off the client hint", () => {
    expect(visitContext(headers({ "sec-ch-ua-mobile": "?1" }))).toMatchObject({ device: "mobile" });
  });

  it("falls back to the user agent for a browser that sends no hints", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const ipad =
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1";
    const mac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

    expect(visitContext(headers({ "user-agent": iphone }))).toMatchObject({ device: "mobile" });
    expect(visitContext(headers({ "user-agent": ipad }))).toMatchObject({ device: "tablet" });
    expect(visitContext(headers({ "user-agent": mac }))).toMatchObject({ device: "desktop" });
  });

  // An Android tablet says "Android" without "Mobile", so asking "is it a phone" first would read
  // every one of them as a phone.
  it("tells an Android tablet from an Android phone", () => {
    const phone =
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
    const tablet =
      "Mozilla/5.0 (Linux; Android 15; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

    expect(visitContext(headers({ "user-agent": phone }))).toMatchObject({ device: "mobile" });
    expect(visitContext(headers({ "user-agent": tablet }))).toMatchObject({ device: "tablet" });
  });

  it("says nothing about a request with no hint and no agent, rather than filing it as a computer", () => {
    expect(visitContext(headers({}))).toEqual({});
  });

  // Never the IP, and never the agent string itself. Both are read on the way past and neither is
  // kept: what comes out is a two-letter country and one word from a closed set of three.
  it("returns nothing but a country and a device class", () => {
    const context = visitContext(
      headers({
        "cf-ipcountry": "GB",
        "sec-ch-ua-mobile": "?1",
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    );

    expect(Object.keys(context).sort()).toEqual(["country", "device"]);
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

  // The page cannot claim a country or a device class either. Those are the server's to derive, and
  // a value a visitor could choose is a value that says nothing.
  it("strips a country and a device class the page tried to send", async () => {
    track("landing_view", { country: "US", device: "desktop", path: "/" } as never);

    expect(await beaconBody()).toEqual({ name: "landing_view", properties: { path: "/" } });
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
    // The BROWSER list, because that is the only one `track` can put in a body: the two the server
    // derives are added on the far side of this request, where the 2 KB limit no longer applies.
    const stuffed = Object.fromEntries(BROWSER_PROPERTY_KEYS.map((key) => [key, atCap]));

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
