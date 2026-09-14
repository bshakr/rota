import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuthKit and Next navigation are the two seams the admin client leans on. Mock
// them so the test can assert what token gets forwarded and what a Rails 401 does.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn(async () => ({ accessToken: "JWT_ADMIN_TOKEN", user: { id: "u1" } })),
  getSignInUrl: vi.fn(async () => "https://auth.workos.test/sign-in"),
}));
vi.mock("next/navigation", () => ({
  // The real `redirect` throws NEXT_REDIRECT so control never falls through; mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import {
  connectCalendar,
  createMember,
  disconnectCalendar,
  getMe,
  listCalendarEvents,
  listGroupShifts,
  listShifts,
  listSmsMessages,
  syncCalendar,
  updateRota,
} from "./admin";
import { ApiError } from "./errors";

const redirectMock = redirect as unknown as ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A 204: no body at all, which is what DELETE /api/group/calendar answers with. */
function respondNoContent() {
  return {
    ok: true,
    status: 204,
    json: async () => null,
    text: async () => "",
  } as unknown as Response;
}

function lastFetchCall() {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("admin API client", () => {
  beforeEach(() => {
    process.env.API_URL = "http://rails.test";
    vi.clearAllMocks();
    (withAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: "JWT_ADMIN_TOKEN",
      organizationId: "org_house",
      user: { id: "u1" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the WorkOS access token from withAuth() as a Bearer header", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { user: {}, group: {}, role: "admin" }),
    );
    await getMe();
    const { url, headers } = lastFetchCall();

    expect(withAuth).toHaveBeenCalledWith();
    expect(headers.Authorization).toBe("Bearer JWT_ADMIN_TOKEN");
    expect(url).toBe("http://rails.test/api/me");
  });

  it("sends mutations as top-level JSON (Rails permits at the root, not under a wrapper)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(201, { member: {} }),
    );
    await createMember({ name: "Alice", phone_e164: "+447700900123" });
    const { url, init, headers } = lastFetchCall();

    expect(init.method).toBe("POST");
    expect(url).toBe("http://rails.test/api/members");
    expect(headers.Authorization).toBe("Bearer JWT_ADMIN_TOKEN");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Alice", phone_e164: "+447700900123" });
  });

  it("passes confirm:true for a confirmed schedule change", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(respond(200, { rota: {} }));
    await updateRota(5, { starts_on: "2026-08-01" }, { confirm: true });
    const { url, init } = lastFetchCall();

    expect(init.method).toBe("PATCH");
    expect(url).toBe("http://rails.test/api/rotas/5");
    expect(JSON.parse(init.body as string)).toEqual({ starts_on: "2026-08-01", confirm: true });
  });

  it("sends the pasted iCal link to PUT /api/group/calendar, in the body and nowhere else", async () => {
    const icalUrl = "https://calendar.example.test/private-abc123/basic.ics";
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { calendar: {}, events_preview: [] }),
    );
    await connectCalendar(icalUrl);
    const { url, init } = lastFetchCall();

    expect(init.method).toBe("PUT");
    expect(url).toBe("http://rails.test/api/group/calendar");
    expect(JSON.parse(init.body as string)).toEqual({ ical_url: icalUrl });
    // The link is a credential: it must never ride in the path or a query string,
    // where proxies and access logs would keep a copy of it.
    expect(url).not.toContain("private-abc123");
  });

  it("re-syncs through POST /api/group/calendar/sync", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { calendar: {} }),
    );
    await syncCalendar();
    const { url, init } = lastFetchCall();

    expect(init.method).toBe("POST");
    expect(url).toBe("http://rails.test/api/group/calendar/sync");
    expect(init.body).toBeUndefined();
  });

  it("disconnects through DELETE /api/group/calendar and tolerates the empty 204", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(respondNoContent());

    await expect(disconnectCalendar()).resolves.toBeUndefined();
    const { url, init } = lastFetchCall();

    expect(init.method).toBe("DELETE");
    expect(url).toBe("http://rails.test/api/group/calendar");
  });

  it("asks for a window of calendar events, defaulting to 30 days", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(respond(200, { events: [] }));

    await listCalendarEvents();
    expect(lastFetchCall().url).toBe("http://rails.test/api/group/calendar/events?days=30");

    await listCalendarEvents(7);
    expect(lastFetchCall().url).toBe("http://rails.test/api/group/calendar/events?days=7");
  });

  it("reads the whole house's upcoming turns from one un-nested path, each naming its rota", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { shifts: [{ id: 1, rota_id: 7, rota_name: "Bins", due_on: "2026-03-02" }] }),
    );

    const { shifts } = await listGroupShifts();
    const { url, init } = lastFetchCall();

    expect(init.method ?? "GET").toBe("GET");
    // Bare, not nested under a rota: that is what makes it one request for the whole dashboard.
    expect(url).toBe("http://rails.test/api/shifts");
    // The name travels WITH the shift. The dashboard labels a turn from this and never from a
    // rotas list fetched separately, which used to drop a turn whose rota had changed state.
    expect(shifts[0].rota_name).toBe("Bins");
  });

  it("still reads one rota's shifts from the nested path, for the rota screen", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { shifts: [] }),
    );

    await listShifts(7);

    expect(lastFetchCall().url).toBe("http://rails.test/api/rotas/7/shifts");
  });

  it("builds a query string for the SMS log filters", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(200, { sms_messages: [] }),
    );
    await listSmsMessages({ status: "failed", rota_id: 3, limit: 50 });
    const { url } = lastFetchCall();
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/api/sms_messages");
    expect(parsed.searchParams.get("status")).toBe("failed");
    expect(parsed.searchParams.get("rota_id")).toBe("3");
    expect(parsed.searchParams.get("limit")).toBe("50");
  });

  it("turns a Rails 401 into a clean re-auth, not a crash", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(401, { error: "unauthorized" }),
    );

    await expect(getMe()).rejects.toThrow("REDIRECT:/auth/reauth");
    expect(getSignInUrl).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/auth/reauth");
  });

  it("sends an organization-less signup to setup before any household API request", async () => {
    vi.mocked(withAuth).mockResolvedValue({ user: { id: "new_user" } } as never);
    await expect(getMe()).rejects.toThrow("REDIRECT:/setup");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an expired session to a cookie-capable login handler", async () => {
    vi.mocked(withAuth).mockResolvedValue({ user: null });
    await expect(getMe()).rejects.toThrow("REDIRECT:/auth/sign-in");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates other errors as a typed ApiError without redirecting", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      respond(422, { error: "validation_failed", message: "Name can't be blank." }),
    );

    await expect(createMember({ name: "", phone_e164: "" })).rejects.toBeInstanceOf(ApiError);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
