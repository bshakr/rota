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
});

describe("POST /api/analytics", () => {
  it("forwards an event the browser owns", async () => {
    const response = await post({ name: "cta_click", properties: { position: "hero" } });

    expect(response.status).toBe(204);
    expect(forward).toHaveBeenCalledWith("cta_click", { position: "hero" });
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

    expect(forward).toHaveBeenCalledWith("landing_view", { utm_source: "reddit" });
  });

  // The one property with a closed set of values, so the CTA breakdown can never grow a fourth bar
  // nobody put there.
  it("drops a CTA position it does not recognise, and keeps the event", async () => {
    await post({ name: "cta_click", properties: { position: "sidebar", ref: "member" } });

    expect(forward).toHaveBeenCalledWith("cta_click", { ref: "member" });
  });

  it("accepts each of the three real positions", async () => {
    for (const position of ["hero", "closing", "header"]) {
      await post({ name: "cta_click", properties: { position } });

      expect(forward).toHaveBeenLastCalledWith("cta_click", { position });
    }
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
