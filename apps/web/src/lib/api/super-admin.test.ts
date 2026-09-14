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

import { overviewPayload } from "@/test/overview-payload";
import { spendPayload } from "@/test/spend-payload";
import { trafficPayload } from "@/test/traffic-payload";

import { ApiError } from "./errors";
import { getOverview, getSpend, getTraffic } from "./super-admin";
import { OverviewShapeError } from "./super-admin-overview";
import { SpendShapeError } from "./super-admin-spend";
import { TrafficShapeError } from "./super-admin-traffic";

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
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, overviewPayload())));
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

    await expect(getOverview()).resolves.toMatchObject({ attention_total: 2 });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  // Parsed, not cast. Every figure on the overview is derived, so a key Rails
  // renamed would not show up as an obvious blank — it would render as a zero
  // that looks exactly like a real fact. See ./super-admin-overview.ts.
  it("hands back the parsed payload, with its unions narrowed", async () => {
    const overview = await getOverview();

    expect(overview.kpis.delivery_rate_last_7_days).toBe(96.4);
    expect(overview.attention.map((row) => row.reason)).toEqual([
      "failed_texts",
      "unconfirmed_timezone",
    ]);
  });

  it("refuses a 200 whose shape is not the overview", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(respond(200, {}));

    await expect(getOverview()).rejects.toBeInstanceOf(OverviewShapeError);
    expect(redirectMock).not.toHaveBeenCalled();
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

  // The second surface on this client. The transport, the token and the failure
  // policy are the overview's, already covered above; what is its own is the
  // window it asks for and the second parse.
  describe("super admin traffic", () => {
    beforeEach(() => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        respond(200, trafficPayload()),
      );
    });

    it("asks Rails for the window the page resolved, and nothing else", async () => {
      await getTraffic("90d");

      const { url, headers } = lastFetchCall();
      expect(url).toBe("http://rails.test/api/super_admin/traffic?range=90d");
      expect(headers.Authorization).toBe("Bearer JWT_OPERATOR");
    });

    it("hands back the parsed payload, with its unions narrowed", async () => {
      const traffic = await getTraffic("30d");

      expect(traffic.funnel).toHaveLength(8);
      expect(traffic.funnel[0].tracked).toBe(false);
      expect(traffic.weeks.at(-1)?.delivery_rate).toBe(96.7);
    });

    it("refuses a 200 whose shape is not the traffic payload", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(respond(200, {}));

      await expect(getTraffic("30d")).rejects.toBeInstanceOf(TrafficShapeError);
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it("404s a caller who is not on the allowlist, before any request reaches Rails", async () => {
      withAuthMock.mockResolvedValue({
        accessToken: "JWT_STRANGER",
        organizationId: "org_house",
        user: { id: STRANGER },
      });

      await expect(getTraffic("7d")).rejects.toThrow("NEXT_NOT_FOUND");
      expect(fetch).not.toHaveBeenCalled();
    });

    // Rails answers 400 invalid_range for a window it does not know. The page
    // resolves the URL down to one of three before calling, so this is the shape
    // of a caller that got here another way — and it must surface as a typed
    // error, never as a silent fall back to different figures.
    it("propagates a refused range as a typed ApiError", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        respond(400, { error: "invalid_range", allowed: ["7d", "30d", "90d"] }),
      );

      await expect(getTraffic("30d")).rejects.toBeInstanceOf(ApiError);
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it("turns a Rails 401 into a clean re-auth, not a crash", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        respond(401, { error: "unauthorized" }),
      );

      await expect(getTraffic("30d")).rejects.toThrow("REDIRECT:/auth/reauth");
    });
  });

  // --- Spend ---------------------------------------------------------------
  //
  // The same client, the same gate, the same token. What is worth asserting
  // separately is the window: it travels in the query string, it is the only
  // parameter this API takes, and Rails answers 400 for one it does not know.

  describe("super admin spend", () => {
    beforeEach(() => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        respond(200, spendPayload()),
      );
    });

    it("asks for the window it was given, with the operator's token", async () => {
      await getSpend("90d");
      const { url, headers } = lastFetchCall();

      expect(url).toBe("http://rails.test/api/super_admin/spend?range=90d");
      expect(headers.Authorization).toBe("Bearer JWT_OPERATOR");
    });

    // Parsed, not cast. This payload is nothing but money: a key Rails renamed
    // would not show up as a blank, it would show up as a smaller total.
    it("hands back the parsed payload, money intact at six decimals", async () => {
      const spend = await getSpend("90d");

      expect(spend.houses.map((house) => house.name)).toEqual([
        "Alma Road",
        "Bell Street",
        "Cobbler's Yard",
        "Dray Lane",
      ]);
      expect(spend.totals.total).toBe(17.88923);
      expect(spend.sms_estimated_segment_cost_usd).toBe(0.0079);
    });

    it("refuses a 200 whose shape is not the spend payload", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(respond(200, {}));

      await expect(getSpend("30d")).rejects.toBeInstanceOf(SpendShapeError);
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it("404s a caller who is not on the allowlist, before any request reaches Rails", async () => {
      withAuthMock.mockResolvedValue({
        accessToken: "JWT_STRANGER",
        organizationId: "org_house",
        user: { id: STRANGER },
      });

      await expect(getSpend("30d")).rejects.toThrow("NEXT_NOT_FOUND");
      expect(fetch).not.toHaveBeenCalled();
    });

    it("turns a Rails 401 into a clean re-auth, not a crash", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        respond(401, { error: "unauthorized" }),
      );

      await expect(getSpend("12m")).rejects.toThrow("REDIRECT:/auth/reauth");
    });

    // Rails' own 400 for a window it does not know. Unreachable through the
    // typed union, and worth keeping honest anyway: the page falls back to the
    // default rather than forwarding a hand-typed range, so this is what would
    // happen if that ever stopped being true.
    it("propagates an invalid_range refusal as a typed ApiError", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        respond(400, { error: "invalid_range", allowed: ["30d", "90d", "12m"] }),
      );

      await expect(getSpend("30d")).rejects.toBeInstanceOf(ApiError);
    });
  });
});
