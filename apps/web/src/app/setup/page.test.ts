import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), memberships: vi.fn(), organization: vi.fn() }));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: mocks.auth,
  getWorkOS: () => ({ organizations: { getOrganization: mocks.organization } }),
}));
vi.mock("@/lib/auth/household", () => ({
  membershipsFor: mocks.memberships,
  householdKey: (userId: string) => `rotamonster:first:${userId}`,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("./setup-form", () => ({ SetupForm: () => null }));
vi.mock("@/components/admin/sign-out-button", () => ({ SignOutButton: () => null }));

import SetupPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user_1", email: "house@example.test" } });
  mocks.memberships.mockResolvedValue([]);
});

it("renders setup for a new organization-less signup without household API calls", async () => {
  expect(await SetupPage()).toBeTruthy();
  expect(mocks.organization).not.toHaveBeenCalled();
});

it("offers existing memberships when no organization is selected", async () => {
  mocks.memberships.mockResolvedValue([{ organizationId: "org_house", organizationName: "Our house", status: "active" }]);
  expect(await SetupPage()).toBeTruthy();
  expect(mocks.organization).not.toHaveBeenCalled();
});

it.each([
  { externalId: "another-owner", metadata: {} },
  { externalId: "rotamonster:first:user_1", metadata: { setup_finished: "true" } },
])("returns already-active households to the dashboard", async (organization) => {
  mocks.auth.mockResolvedValue({ user: { id: "user_1" }, organizationId: "org_house" });
  mocks.memberships.mockResolvedValue([{ organizationId: "org_house", status: "active" }]);
  mocks.organization.mockResolvedValue(organization);
  await expect(SetupPage()).rejects.toThrow("REDIRECT:/dashboard");
});

it("keeps partially completed setup available after refresh saved the new org session", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user_1" }, organizationId: "org_house" });
  mocks.memberships.mockResolvedValue([{ organizationId: "org_house", status: "active" }]);
  mocks.organization.mockResolvedValue({ externalId: "rotamonster:first:user_1", metadata: { setup_membership: "complete" } });
  expect(await SetupPage()).toBeTruthy();
});
