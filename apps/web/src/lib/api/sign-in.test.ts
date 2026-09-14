import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordSignIn } from "./sign-in";

function lastFetchCall() {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("recording a sign-in", () => {
  beforeEach(() => {
    process.env.API_URL = "http://rails.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 204, text: async () => "" }) as unknown as Response),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the WorkOS access token to Rails as a bearer header", async () => {
    await recordSignIn("JWT_FROM_AUTHKIT");
    const { url, init, headers } = lastFetchCall();

    expect(init.method).toBe("POST");
    expect(url).toBe("http://rails.test/api/sign_ins");
    expect(headers.Authorization).toBe("Bearer JWT_FROM_AUTHKIT");
    // The token is a credential: never in the path, never in a query string, where a proxy or an
    // access log would keep a copy of it.
    expect(url).not.toContain("JWT_FROM_AUTHKIT");
  });

  // https://linear.app/bloombase/issue/BLO-1696. The access token carries no email and no name, so
  // without this the operator console shows "No name yet / Not provided" for every admin. AuthKit
  // hands the callback the real WorkOS user; this is how it reaches the row.
  it("carries the identity WorkOS gave the callback, in the shape of the row", async () => {
    await recordSignIn("JWT", {
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Nkemdirim",
    });

    expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
      email: "alice@example.com",
      first_name: "Alice",
      last_name: "Nkemdirim",
    });
    expect(lastFetchCall().headers["Content-Type"]).toBe("application/json");
  });

  // A WorkOS user with no name at all is the common case, and it is not a failure: Rails treats a
  // null as "nothing to add" and leaves the column exactly as it was.
  it("says nothing rather than guessing when WorkOS holds no name", async () => {
    await recordSignIn("JWT", { email: "alice@example.com" });

    expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
      email: "alice@example.com",
      first_name: null,
      last_name: null,
    });
  });

  it("still posts when there is no identity to carry at all", async () => {
    await expect(recordSignIn("JWT")).resolves.toBeUndefined();

    expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
      email: null,
      first_name: null,
      last_name: null,
    });
  });

  it("bounds how long it can delay the redirect", async () => {
    await recordSignIn("JWT");

    expect(lastFetchCall().init.signal).toBeInstanceOf(AbortSignal);
  });

  // The whole contract. Sign-in works or it does not; a telemetry call has no business deciding
  // which, so every failure mode below has to end in a resolved promise.
  it("never rejects when Rails refuses the token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    } as unknown as Response);

    await expect(recordSignIn("JWT")).resolves.toBeUndefined();
  });

  it("never rejects when Rails cannot be reached at all", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(recordSignIn("JWT")).resolves.toBeUndefined();
  });

  it("never rejects when the API origin is not configured", async () => {
    delete process.env.API_URL;

    await expect(recordSignIn("JWT")).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
