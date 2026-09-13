import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The same two seams admin.test.ts mocks — AuthKit and Next navigation — so the
// test can assert which token is forwarded, and what a Rails 401 and a refused
// caller each do. `notFound()` really throws, so mirror that.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn(async () => ({ accessToken: "JWT_OPERATOR", user: { id: "user_operator" } })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { withAuth } from "@workos-inc/authkit-nextjs";
import { notFound, redirect } from "next/navigation";

import { ApiError } from "./errors";
import { getOverview } from "./super-admin";

const OPERATOR = "user_operator";
const STRANGER = "user_stranger";

const redirectMock = redirect as unknown as ReturnType<typeof vi.fn>;
const notFoundMock = notFound as unknown as ReturnType<typeof vi.fn>;
const withAuthMock = withAuth as unknown as ReturnType<typeof vi.fn>;

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

describe("super admin API client", () => {
  beforeEach(() => {
    process.env.API_URL = "http://rails.test";
    process.env.SUPER_ADMIN_WORKOS_USER_IDS = OPERATOR;
    vi.clearAllMocks();
    withAuthMock.mockResolvedValue({ accessToken: "JWT_OPERATOR", user: { id: OPERATOR } });
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, {})));
  });

  afterEach(() => {
    delete process.env.SUPER_ADMIN_WORKOS_USER_IDS;
    vi.unstubAllGlobals();
  });

  it("forwards the WorkOS access token from withAuth() as a Bearer header", async () => {
    await getOverview();
    const { url, headers } = lastFetchCall();

    expect(withAuth).toHaveBeenCalledWith();
    expect(headers.Authorization).toBe("Bearer JWT_OPERATOR");
    expect(url).toBe("http://rails.test/api/super_admin/overview");
  });

  // The whole point of the second client: no organization is required, so an
  // operator with no house of their own is not diverted to /setup.
  it("reaches Rails with an org-less token instead of sending the operator to setup", async () => {
    withAuthMock.mockResolvedValue({ accessToken: "JWT_OPERATOR", user: { id: OPERATOR } });

    await expect(getOverview()).resolves.toEqual({});
    expect(redirectMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("tolerates the empty overview payload the endpoint answers with today", async () => {
    await expect(getOverview()).resolves.toEqual({});
  });

  it("404s a caller who is not on the allowlist, before any request reaches Rails", async () => {
    withAuthMock.mockResolvedValue({
      accessToken: "JWT_STRANGER",
      organizationId: "org_house",
      user: { id: STRANGER },
    });

    await expect(getOverview()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("404s everyone while the allowlist is unset", async () => {
    delete process.env.SUPER_ADMIN_WORKOS_USER_IDS;

    await expect(getOverview()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("404s an expired session rather than rendering the area", async () => {
    withAuthMock.mockResolvedValue({ user: null });

    await expect(getOverview()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns a Rails 401 into a clean re-auth, not a crash", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(401, { error: "unauthorized" }),
    );

    await expect(getOverview()).rejects.toThrow("REDIRECT:/auth/reauth");
    expect(redirectMock).toHaveBeenCalledWith("/auth/reauth");
  });

  // Rails answers 404 both for "you are not a super admin" and for "no such
  // record". The client hands it to the caller as a typed error rather than
  // guessing which one it was.
  it("propagates a Rails 404 as a typed ApiError without redirecting", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(404, { error: "not_found" }),
    );

    await expect(getOverview()).rejects.toBeInstanceOf(ApiError);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("propagates a server error as a typed ApiError", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(500, { error: "server_error" }),
    );

    await expect(getOverview()).rejects.toBeInstanceOf(ApiError);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
