import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), refresh: vi.fn(), list: vi.fn(), createMembership: vi.fn(),
  lookup: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), request: vi.fn(),
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: mocks.auth,
  switchToOrganization: mocks.refresh,
  getWorkOS: () => ({
    userManagement: { listOrganizationMemberships: mocks.list, createOrganizationMembership: mocks.createMembership },
    organizations: { getOrganizationByExternalId: mocks.lookup, createOrganization: mocks.create,
      getOrganization: mocks.get, updateOrganization: mocks.update },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) throw error;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ requestJson: mocks.request }));

import { initialHousehold } from "@/lib/auth/household";
import { setupHousehold } from "./actions";

const organization = {
  id: "org_new", name: "Our house", externalId: "rotamonster:first:user_1",
  metadata: { setup_timezone: "Europe/London", setup_membership: "pending" },
};
const member = { userId: "user_1", organizationId: "org_new", status: "active" };
function listed(memberships: object[]) {
  return { autoPagination: async () => memberships };
}
function form(values: Record<string, string> = { name: "Our house", timezone: "Europe/London" }) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const submit = (data = form()) => setupHousehold({ error: "" }, data);

describe("first household setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.refresh.mockResolvedValue({ user: { id: "user_1" }, organizationId: "org_new", accessToken: "NEW_ORG_TOKEN" });
    mocks.list.mockResolvedValue(listed([]));
    mocks.lookup.mockRejectedValue({ status: 404 });
    mocks.create.mockResolvedValue(organization);
    mocks.get.mockResolvedValue(organization);
    mocks.request.mockResolvedValue({ group: { timezone_confirmed: false } });
  });

  it("creates a household and membership, refreshes into it and initializes Rails with the NEW token", async () => {
    await expect(submit()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.create).toHaveBeenCalledWith({ name: "Our house", externalId: "rotamonster:first:user_1",
      metadata: { setup_timezone: "Europe/London", setup_membership: "pending" } });
    expect(mocks.createMembership).toHaveBeenCalledWith({ userId: "user_1", organizationId: "org_new" });
    expect(mocks.refresh).toHaveBeenCalledWith("org_new", { revalidationStrategy: "none", returnTo: "/setup" });
    expect(mocks.request).toHaveBeenLastCalledWith("/api/group", "NEW_ORG_TOKEN", {
      method: "PATCH", body: { name: "Our house", timezone: "Europe/London" },
    });
  });

  it("authenticates direct server action requests before reading memberships or creating anything", async () => {
    mocks.auth.mockResolvedValue({ user: null });
    await expect(submit()).rejects.toThrow("REDIRECT:/auth/sign-in");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([{ name: " ", timezone: "UTC" }, { name: "House", timezone: "not-a-zone" },
    { name: "x".repeat(101), timezone: "UTC" }])("validates household fields before writes", async (values) => {
    expect((await submit(form(values))).error).toContain("valid timezone");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not create another house for an existing member", async () => {
    mocks.list.mockResolvedValue(listed([member]));
    expect((await submit()).error).toContain("already belong");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("selects an existing membership without creating or renaming its household", async () => {
    mocks.list.mockResolvedValue(listed([member]));
    mocks.get.mockResolvedValue({ ...organization, externalId: "someone-elses-house" });
    await expect(submit(form({ organizationId: "org_new" }))).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createMembership).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([{ memberships: [] }, { memberships: [{ ...member, status: "inactive" }] },
    { memberships: [{ ...member, status: "pending" }] }])(
    "rejects arbitrary or inactive org selections", async ({ memberships }) => {
      mocks.list.mockResolvedValue(listed(memberships));
      expect((await submit(form({ organizationId: "org_new" }))).error).toContain("no longer have access");
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("recovers a create committed before a network timeout without making a second household", async () => {
    mocks.create.mockRejectedValue(new Error("timeout"));
    mocks.lookup.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce(organization);
    await expect(submit()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("recovers an organization after a failed membership creation", async () => {
    mocks.lookup.mockResolvedValue(organization);
    await expect(submit()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createMembership).toHaveBeenCalledOnce();
  });

  it("recovers a concurrently completed membership create", async () => {
    mocks.createMembership.mockRejectedValue(new Error("conflict"));
    mocks.list.mockResolvedValueOnce(listed([])).mockResolvedValueOnce(listed([])).mockResolvedValueOnce(listed([member]));
    await expect(submit()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("does not recreate a removed membership after initial provisioning completed", async () => {
    mocks.lookup.mockResolvedValue({ ...organization, metadata: { ...organization.metadata, setup_membership: "complete" } });
    expect((await submit()).error).toContain("membership was removed");
    expect(mocks.createMembership).not.toHaveBeenCalled();
  });

  it("does not reactivate an inactive membership during a retry", async () => {
    mocks.lookup.mockResolvedValue(organization);
    mocks.list.mockResolvedValue(listed([{ ...member, status: "inactive" }]));
    expect((await submit()).error).toContain("not active");
    expect(mocks.createMembership).not.toHaveBeenCalled();
  });

  it("uses saved settings when retrying after Rails was unavailable", async () => {
    mocks.list.mockResolvedValue(listed([member]));
    await expect(submit(form({ organizationId: "org_new" }))).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.request).toHaveBeenLastCalledWith("/api/group", "NEW_ORG_TOKEN", {
      method: "PATCH", body: { name: "Our house", timezone: "Europe/London" },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["GET", "PATCH"])("recovers after Rails %s fails following a successful session refresh", async (method) => {
    if (method === "GET") mocks.request.mockRejectedValueOnce(new Error("Rails unavailable"));
    else mocks.request.mockResolvedValueOnce({ group: { timezone_confirmed: false } }).mockRejectedValueOnce(new Error("Rails unavailable"));
    expect((await submit()).error).toContain("progress is saved");
    mocks.auth.mockResolvedValue({ user: { id: "user_1" }, organizationId: "org_new" });
    mocks.list.mockResolvedValue(listed([member]));
    await expect(submit(form({ organizationId: "org_new" }))).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenLastCalledWith("/api/group", "NEW_ORG_TOKEN", {
      method: "PATCH", body: { name: "Our house", timezone: "Europe/London" },
    });
  });

  it("preserves AuthKit MFA/SSO challenge redirects", async () => {
    mocks.refresh.mockRejectedValue(new Error("REDIRECT:https://auth.workos.test/mfa"));
    await expect(submit()).rejects.toThrow("REDIRECT:https://auth.workos.test/mfa");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not overwrite confirmed settings on successful retry", async () => {
    mocks.list.mockResolvedValue(listed([member]));
    mocks.request.mockResolvedValue({ group: { timezone_confirmed: true } });
    await expect(submit(form({ organizationId: "org_new" }))).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("does not forward a token scoped to a different household", async () => {
    mocks.refresh.mockResolvedValue({ user: { id: "user_1" }, organizationId: "org_other", accessToken: "BAD" });
    expect((await submit()).error).toContain("couldn't activate");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("returns a safe retry message when providers are down", async () => {
    mocks.request.mockRejectedValue(new Error("SECRET_PROVIDER_DETAIL"));
    expect((await submit()).error).toBe("We couldn't finish setting up your household. Please try again. Your progress is saved.");
  });

  it("does not treat lookup outages as permission to create", async () => {
    mocks.lookup.mockRejectedValue({ status: 503 });
    await expect(initialHousehold("user_1", "House", "UTC")).rejects.toEqual({ status: 503 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
