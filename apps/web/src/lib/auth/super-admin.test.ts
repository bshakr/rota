import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two seams the guard leans on: AuthKit for the session, and Next's
// `notFound()` — which really throws, so control never falls through to a page.
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { withAuth } from "@workos-inc/authkit-nextjs";
import { notFound } from "next/navigation";

import {
  isSuperAdmin,
  parseSuperAdminIds,
  requireSuperAdmin,
  superAdminIds,
} from "./super-admin";

const OPERATOR = "user_01HQ9OPERATOR";
const STRANGER = "user_01HQ9STRANGER";

const notFoundMock = notFound as unknown as ReturnType<typeof vi.fn>;
const withAuthMock = withAuth as unknown as ReturnType<typeof vi.fn>;

describe("parseSuperAdminIds", () => {
  it("splits on commas and trims each id", () => {
    expect(parseSuperAdminIds(`${OPERATOR},${STRANGER}`)).toEqual([OPERATOR, STRANGER]);
    expect(parseSuperAdminIds(`  ${OPERATOR} ,\t${STRANGER}\n`)).toEqual([OPERATOR, STRANGER]);
  });

  it("reads a single id with no comma at all", () => {
    expect(parseSuperAdminIds(OPERATOR)).toEqual([OPERATOR]);
  });

  // The shapes a hand-edited env var actually takes: a trailing comma, a double
  // comma, a value that is nothing but whitespace.
  it("drops empty entries rather than admitting a blank id", () => {
    expect(parseSuperAdminIds(`${OPERATOR},`)).toEqual([OPERATOR]);
    expect(parseSuperAdminIds(`${OPERATOR},,${STRANGER}`)).toEqual([OPERATOR, STRANGER]);
    expect(parseSuperAdminIds("   ")).toEqual([]);
    expect(parseSuperAdminIds(",,,")).toEqual([]);
  });

  it("treats unset and empty as nobody", () => {
    expect(parseSuperAdminIds(undefined)).toEqual([]);
    expect(parseSuperAdminIds(null)).toEqual([]);
    expect(parseSuperAdminIds("")).toEqual([]);
  });
});

describe("the allowlist read from the environment", () => {
  afterEach(() => {
    delete process.env.SUPER_ADMIN_WORKOS_USER_IDS;
  });

  it("reads the variable at call time, so a later value is picked up", () => {
    expect(superAdminIds()).toEqual([]);
    process.env.SUPER_ADMIN_WORKOS_USER_IDS = `${OPERATOR}, ${STRANGER}`;
    expect(superAdminIds()).toEqual([OPERATOR, STRANGER]);
  });

  it("matches an allowlisted id exactly", () => {
    process.env.SUPER_ADMIN_WORKOS_USER_IDS = OPERATOR;
    expect(isSuperAdmin(OPERATOR)).toBe(true);
    expect(isSuperAdmin(STRANGER)).toBe(false);
    // No prefix or substring match: a longer id that merely starts with an
    // allowlisted one is a different user.
    expect(isSuperAdmin(`${OPERATOR}_2`)).toBe(false);
  });

  // The rollout depends on this: the code ships before the variable is set, and
  // must be inert until it is.
  it("says nobody when the variable is unset — including in development", () => {
    expect(isSuperAdmin(OPERATOR)).toBe(false);
    process.env.SUPER_ADMIN_WORKOS_USER_IDS = "";
    expect(isSuperAdmin(OPERATOR)).toBe(false);
  });

  it("never treats a missing user id as allowlisted", () => {
    process.env.SUPER_ADMIN_WORKOS_USER_IDS = OPERATOR;
    expect(isSuperAdmin(undefined)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin("")).toBe(false);
  });
});

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPER_ADMIN_WORKOS_USER_IDS = OPERATOR;
  });

  afterEach(() => {
    delete process.env.SUPER_ADMIN_WORKOS_USER_IDS;
  });

  it("returns the session for an allowlisted operator, with no household needed", async () => {
    // No organizationId: an operator may have no house of their own, and that
    // must not stand between them and the area.
    withAuthMock.mockResolvedValue({ user: { id: OPERATOR }, accessToken: "JWT_OPERATOR" });

    const auth = await requireSuperAdmin();

    expect(auth.accessToken).toBe("JWT_OPERATOR");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("404s a signed-in admin who is not on the list — never 403", async () => {
    withAuthMock.mockResolvedValue({
      user: { id: STRANGER },
      organizationId: "org_house",
      accessToken: "JWT_STRANGER",
    });

    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("404s when there is no session at all", async () => {
    withAuthMock.mockResolvedValue({ user: null });

    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s everyone when the allowlist is unset", async () => {
    delete process.env.SUPER_ADMIN_WORKOS_USER_IDS;
    withAuthMock.mockResolvedValue({ user: { id: OPERATOR }, accessToken: "JWT_OPERATOR" });

    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
