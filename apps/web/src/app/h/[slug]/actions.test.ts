import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEntryLink } from "./actions";

describe("public household entry", () => {
  beforeEach(() => {
    vi.stubEnv("API_URL", "http://api.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"accepted":true}', { status: 202 })));
  });
  function form(phone: string) { const data = new FormData(); data.set("phone", phone); return data; }

  it("posts the number without forwarding admin credentials and returns only neutral text", async () => {
    const result = await sendEntryLink("park-vista", { message: "" }, form("+447700900123"));
    expect(fetch).toHaveBeenCalledWith("http://api.test/public/households/park-vista/request_link", expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ phone: "+447700900123" }),
    }));
    expect(result.message).toMatch(/^If that number/);
    expect(result.error).toBeUndefined();
  });

  it.each(["../members", "a/b", "x".repeat(81), ""])("rejects unsafe household argument %s", async (slug) => {
    expect((await sendEntryLink(slug, { message: "" }, form("+447700900123"))).error).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(41)])("bounds the phone input", async (phone) => {
    expect((await sendEntryLink("park-vista", { message: "" }, form(phone))).error).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a recoverable error for an API outage", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("private infrastructure details"));
    const result = await sendEntryLink("park-vista", { message: "" }, form("+447700900123"));
    expect(result.error).toBe(true);
    expect(result.message).not.toContain("private infrastructure");
  });
});
