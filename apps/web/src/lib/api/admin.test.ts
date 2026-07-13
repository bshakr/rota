import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuthKit and Next navigation are the two seams the admin client leans on. Mock
// them so the test can assert what token gets forwarded and what a Rails 401 does.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn(async () => ({ accessToken: "JWT_ADMIN_TOKEN", user: { id: "u1" } })),
  getSignInUrl: vi.fn(async () => "https://auth.workos.test/sign-in"),
}));
vi.mock("next/navigation", () => ({
  // The real `redirect` throws NEXT_REDIRECT so control never falls through; mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import { createMember, getMe, listSmsMessages, updateRota } from "./admin";
import { ApiError } from "./errors";

const redirectMock = redirect as unknown as ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function lastFetchCall() {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("admin API client", () => {
  beforeEach(() => {
    process.env.API_URL = "http://rails.test";
    vi.clearAllMocks();
    (withAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: "JWT_ADMIN_TOKEN",
      user: { id: "u1" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the WorkOS access token from withAuth() as a Bearer header", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { user: {}, group: {}, role: "admin" }),
    );
    await getMe();
    const { url, headers } = lastFetchCall();

    expect(withAuth).toHaveBeenCalledWith({ ensureSignedIn: true });
    expect(headers.Authorization).toBe("Bearer JWT_ADMIN_TOKEN");
    expect(url).toBe("http://rails.test/api/me");
  });

  it("sends mutations as top-level JSON (Rails permits at the root, not under a wrapper)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(201, { member: {} }),
    );
    await createMember({ name: "Alice", phone_e164: "+447700900123" });
    const { url, init, headers } = lastFetchCall();

    expect(init.method).toBe("POST");
    expect(url).toBe("http://rails.test/api/members");
    expect(headers.Authorization).toBe("Bearer JWT_ADMIN_TOKEN");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Alice", phone_e164: "+447700900123" });
  });

  it("passes confirm:true for a confirmed schedule change", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(respond(200, { rota: {} }));
    await updateRota(5, { starts_on: "2026-08-01" }, { confirm: true });
    const { url, init } = lastFetchCall();

    expect(init.method).toBe("PATCH");
    expect(url).toBe("http://rails.test/api/rotas/5");
    expect(JSON.parse(init.body as string)).toEqual({ starts_on: "2026-08-01", confirm: true });
  });

  it("builds a query string for the SMS log filters", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { sms_messages: [] }),
    );
    await listSmsMessages({ status: "failed", rota_id: 3, limit: 50 });
    const { url } = lastFetchCall();
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/api/sms_messages");
    expect(parsed.searchParams.get("status")).toBe("failed");
    expect(parsed.searchParams.get("rota_id")).toBe("3");
    expect(parsed.searchParams.get("limit")).toBe("50");
  });

  it("turns a Rails 401 into a clean re-auth, not a crash", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(401, { error: "unauthorized" }),
    );

    await expect(getMe()).rejects.toThrow("REDIRECT:https://auth.workos.test/sign-in");
    expect(getSignInUrl).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledWith("https://auth.workos.test/sign-in");
  });

  it("propagates other errors as a typed ApiError without redirecting", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(422, { error: "validation_failed", message: "Name can't be blank." }),
    );

    await expect(createMember({ name: "", phone_e164: "" })).rejects.toBeInstanceOf(ApiError);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
