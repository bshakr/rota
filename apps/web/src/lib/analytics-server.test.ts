import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyticsConfigured, captureServerEvent, forwardAnalyticsEvent } from "./analytics-server";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configured() {
  vi.stubEnv("ANALYTICS_SHARED_SECRET", "a-shared-secret");
}

describe("with no ANALYTICS_SHARED_SECRET", () => {
  // The state in CI, in tests and on a developer's machine. Nothing leaves the process, and Rails
  // answers 404 to anyone who finds the endpoint, so there is no open write path anywhere.
  it("is off, and reaches no network", async () => {
    vi.stubEnv("ANALYTICS_SHARED_SECRET", "");

    expect(analyticsConfigured()).toBe(false);
    expect(await forwardAnalyticsEvent("landing_view")).toBe(false);
    captureServerEvent("signin_completed");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("forwardAnalyticsEvent", () => {
  beforeEach(configured);

  it("posts to the Rails internal endpoint with the shared secret", async () => {
    expect(await forwardAnalyticsEvent("cta_click", { position: "hero" })).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/internal/analytics/events");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Analytics-Secret"]).toBe("a-shared-secret");
    expect(JSON.parse(init.body)).toEqual({ name: "cta_click", properties: { position: "hero" } });
  });

  it("sanitises again on the way out, so nothing unlisted can reach Rails", async () => {
    await forwardAnalyticsEvent("landing_view", { utm_source: "reddit", phone: "+447400123003" } as never);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).properties).toEqual({ utm_source: "reddit" });
  });

  it("reports a refusal from Rails as a failure rather than pretending" , async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    expect(await forwardAnalyticsEvent("landing_view")).toBe(false);
  });

  it("never rejects when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(forwardAnalyticsEvent("landing_view")).resolves.toBe(false);
  });
});

describe("captureServerEvent", () => {
  beforeEach(configured);

  // handleAuth awaits its onSuccess hook, so this must return before the request finishes and must
  // never reject: a Rails hiccup cannot be allowed to slow down or break a login.
  it("returns immediately and swallows a failing request", () => {
    fetchMock.mockRejectedValue(new Error("unreachable"));

    expect(() => captureServerEvent("signin_completed")).not.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
