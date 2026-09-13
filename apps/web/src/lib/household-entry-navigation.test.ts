import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { HouseholdEntryLink, copyHouseholdLink } from "@/app/(admin)/dashboard/_components/household-entry-link";
import HouseholdNotFound from "@/app/h/[slug]/not-found";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { origin: "https://rota.monster" } });
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("opens the stored household slug including its suffix", () => {
  const html = renderToStaticMarkup(React.createElement(HouseholdEntryLink, { slug: "park-vista-2" }));
  expect(html).toContain('href="/h/park-vista-2"');
  expect(html).toContain("Open household page");
  expect(html).toContain("Copy link");
  expect(html).not.toContain('href="/h/park-vista"');
});

it("copies the absolute public URL, not an API URL or a guessed household name", async () => {
  await copyHouseholdLink("/h/park-vista-2");
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://rota.monster/h/park-vista-2");
  expect(toast.success).toHaveBeenCalledWith("Household link copied.");
});

it("offers manual copying when the clipboard is unavailable", async () => {
  vi.stubGlobal("navigator", {});
  await copyHouseholdLink("/h/park-vista-2");
  expect(toast.error).toHaveBeenCalledWith("Couldn’t copy the link. Open the household page and copy its address.");
  expect(toast.success).not.toHaveBeenCalled();
});

it("does not claim success when clipboard permission is denied", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("Denied"));
  await copyHouseholdLink("/h/park-vista-2");
  expect(toast.error).toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

it("gives missing-household visitors a dashboard route to their actual link", () => {
  const html = renderToStaticMarkup(React.createElement(HouseholdNotFound));
  expect(html).toContain('href="/dashboard"');
  expect(html).toContain("Open admin dashboard");
  expect(html).toContain("ask your household admin");
});

it("places the entry controls above dashboard warnings using the saved slug", () => {
  const source = readFileSync(new URL("../app/(admin)/dashboard/page.tsx", import.meta.url), "utf8");
  expect(source).toContain("<HouseholdEntryLink slug={group.slug} />");
  expect(source.indexOf("<HouseholdEntryLink")).toBeLessThan(source.indexOf("<DashboardWarnings"));
});
