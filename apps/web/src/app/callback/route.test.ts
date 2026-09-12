import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

it("returns a successful container callback to the configured public origin", async () => {
  const password = "callback-test-password-at-least-32-characters";
  vi.stubEnv("APP_URL", "https://rota.monster");
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", password);
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  authenticateWithCode.mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    user: { id: "user_test" },
  });
  const state = await sealData(
    { nonce: "test-nonce", codeVerifier: "test-verifier", returnPathname: "/dashboard" },
    { password },
  );
  const request = new NextRequest(
    `https://0.0.0.0:3001/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: `wos-auth-verifier=${state}` } },
  );
  const { GET } = await import("./route");
  const response = await GET(request);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://rota.monster/dashboard");
  expect(authenticateWithCode).toHaveBeenCalledOnce();
  expect(setCookie).toHaveBeenCalledWith("wos-session", expect.any(String), expect.any(Object));
}, 30_000);
