import { expect, it, vi } from "vitest";

vi.mock("@workos-inc/authkit-nextjs", () => ({ getSignInUrl: vi.fn(async () => "https://auth.workos.test/sign-in") }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { GET } from "./route";

it("starts sign-in in the cookie-capable handler with a fixed local destination", async () => {
  await expect(GET()).rejects.toThrow("REDIRECT:https://auth.workos.test/sign-in");
  expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: "/dashboard" });
});
