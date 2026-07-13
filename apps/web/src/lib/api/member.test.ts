import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assignCover, cancelCover, getMemberShifts } from "./member";

// A token a real member link would carry. The whole point of the member client is
// that this value only ever appears in the Authorization header — never in a URL
// path or query, where Rails would log it verbatim (it is a permanent credential).
const TOKEN = "6f1e2d3c4b5a69788796a5b4c3d2e1f0aabbccddeeff0011";

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function lastFetchCall() {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, init, headers };
}

describe("member API client", () => {
  beforeEach(() => {
    process.env.API_URL = "http://rails.test";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the member token as a Bearer header — and NOWHERE in the URL", async () => {
    await getMemberShifts(TOKEN);
    const { url, headers } = lastFetchCall();

    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).toBe("http://rails.test/api/member/shifts");
    // The load-bearing assertion: the token is never a path segment or query param.
    expect(url).not.toContain(TOKEN);
  });

  it("posts a cover with the token in the header and only the shift id in the path", async () => {
    await assignCover(TOKEN, 42, 7);
    const { url, init, headers } = lastFetchCall();

    expect(url).toBe("http://rails.test/api/member/shifts/42/cover");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ covering_member_id: 7 });
    // The token must not have leaked into the body either.
    expect(init.body as string).not.toContain(TOKEN);
  });

  it("cancels a cover with DELETE and no token in the URL", async () => {
    await cancelCover(TOKEN, 99);
    const { url, init, headers } = lastFetchCall();

    expect(url).toBe("http://rails.test/api/member/shifts/99/cover");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("DELETE");
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("across every call, the token appears only in the Authorization header", async () => {
    await getMemberShifts(TOKEN);
    await assignCover(TOKEN, 1, 2);
    await cancelCover(TOKEN, 3);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url).not.toContain(TOKEN);
      expect((init.body as string | undefined) ?? "").not.toContain(TOKEN);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("is guarded by `server-only` so it can never be pulled into the client bundle", () => {
    const source = readFileSync(fileURLToPath(new URL("./member.ts", import.meta.url)), "utf8");
    expect(source.trimStart().startsWith('import "server-only";')).toBe(true);
  });
});
