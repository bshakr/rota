import { afterEach, expect, it, vi } from "vitest";

vi.mock("@workos-inc/authkit-nextjs", () => ({ signOut: vi.fn(async () => undefined) }));

import { signOut } from "@workos-inc/authkit-nextjs";

import { signOutAction } from "./actions";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(signOut).mockClear();
});

// The regression: a relative `returnTo` reaches WorkOS's logout endpoint as
// `return_to=/`, which WorkOS drops, falling back to the unset dashboard "App
// homepage URL" and showing app-homepage-url-not-found. It has to be absolute.
it("signs out back to the site's absolute homepage", async () => {
  vi.stubEnv("APP_URL", "https://preview.example.com");

  await signOutAction();

  expect(signOut).toHaveBeenCalledWith({ returnTo: "https://preview.example.com/" });
});

it("falls back to the production homepage when APP_URL is unset", async () => {
  vi.stubEnv("APP_URL", undefined);

  await signOutAction();

  expect(signOut).toHaveBeenCalledWith({ returnTo: "https://rota.monster/" });
});
