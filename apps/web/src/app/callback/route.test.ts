import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { setCookie, authenticateWithCode } = vi.hoisted(() => ({
  setCookie: vi.fn(),
  authenticateWithCode: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie }),
  headers: async () => new Headers(),
}));

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    userManagement = { authenticateWithCode };
  },
}));

const PASSWORD = "callback-test-password-at-least-32-characters";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://rota.monster");
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", PASSWORD);
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  vi.stubEnv("API_URL", "http://rails.test");
  authenticateWithCode.mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    user: {
      id: "user_test",
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Nkemdirim",
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 204, text: async () => "" }) as unknown as Response),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  vi.restoreAllMocks();
});

/** The shape WorkOS redirects back with: a one-time code plus the sealed PKCE state. */
async function callbackRequest() {
  const state = await sealData(
    { nonce: "test-nonce", codeVerifier: "test-verifier", returnPathname: "/dashboard" },
    { password: PASSWORD },
  );
  return new NextRequest(
    `https://0.0.0.0:3001/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: `wos-auth-verifier=${state}` } },
  );
}

async function handleCallback() {
  const { GET } = await import("./route");
  return GET(await callbackRequest());
}

it("returns a successful container callback to the configured public origin", async () => {
  const response = await handleCallback();

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://rota.monster/dashboard");
  expect(authenticateWithCode).toHaveBeenCalledOnce();
  expect(setCookie).toHaveBeenCalledWith("wos-session", expect.any(String), expect.any(Object));
}, 30_000);

// The top of the conversion funnel, recorded at the only moment it is visible: an admin who signs
// in and then abandons /setup never calls an authenticated endpoint, so nothing else in the product
// ever learns that they signed in (https://linear.app/bloombase/issue/BLO-1671).
it("tells Rails about the sign-in, carrying the fresh access token", async () => {
  await handleCallback();

  const [url, init] = vi.mocked(fetch).mock.calls.at(-1) as unknown as [string, RequestInit];
  expect(url).toBe("http://rails.test/api/sign_ins");
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
}, 30_000);

// The access token carries no email and no name unless the WorkOS JWT template has been configured
// to add them, so Rails provisioned every admin with a placeholder address and a null name and the
// operator console could only say "No name yet / Not provided"
// (https://linear.app/bloombase/issue/BLO-1696). This callback is the one place that holds the real
// WorkOS user, so this is the one place the row can learn who it belongs to.
it("forwards the identity WorkOS authenticated, not just the token", async () => {
  await handleCallback();

  const [, init] = vi.mocked(fetch).mock.calls.at(-1) as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    email: "alice@example.com",
    first_name: "Alice",
    last_name: "Nkemdirim",
  });
}, 30_000);

// AuthKit awaits this hook before it redirects, so a broken or unreachable Rails would otherwise be
// able to strand an admin on a blank callback page. Instrumentation does not get to fail a sign-in.
it("signs the admin in anyway when Rails cannot be reached", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

  const response = await handleCallback();

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://rota.monster/dashboard");
  expect(setCookie).toHaveBeenCalledWith("wos-session", expect.any(String), expect.any(Object));
}, 30_000);
