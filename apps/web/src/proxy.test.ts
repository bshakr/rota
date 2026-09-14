import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIRST_TOUCH_COOKIE, decodeFirstTouch } from "@/lib/first-touch";

// AuthKit is stubbed out entirely. What is under test is the wrapper around it: whether the
// first-touch cookie is stamped onto the response AuthKit produced, and — more importantly — that
// the wrapper never changes where a request goes.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitProxy: () => async () => NextResponse.next(),
}));

afterEach(() => {
  vi.resetModules();
});

async function stamp(url: string, cookies: Record<string, string> = {}, response?: NextResponse) {
  const { stampFirstTouch } = await import("./proxy");
  const request = new NextRequest(url, {
    headers: {
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
  });

  return stampFirstTouch(request, response ?? NextResponse.next());
}

function firstTouchOn(response: unknown) {
  return decodeFirstTouch((response as NextResponse).cookies.get(FIRST_TOUCH_COOKIE)?.value);
}

describe("the first-touch cookie the proxy stamps", () => {
  it("records the campaign a visitor landed on `/` with", async () => {
    const response = await stamp("https://rota.monster/?utm_source=reddit&utm_medium=social&ref=r-ukhousing");

    expect(firstTouchOn(response)).toEqual({
      utm_source: "reddit",
      utm_medium: "social",
      ref: "r-ukhousing",
    });
  });

  it("sets nothing for a direct visit", async () => {
    const response = await stamp("https://rota.monster/");

    expect((response as NextResponse).cookies.get(FIRST_TOUCH_COOKIE)).toBeUndefined();
  });

  // First means first. A visitor who bookmarks the page and comes back through a different link
  // keeps the campaign that actually brought them.
  it("never overwrites a cookie the visitor already carries", async () => {
    const response = await stamp(
      "https://rota.monster/?utm_source=instagram",
      { [FIRST_TOUCH_COOKIE]: encodeURIComponent(JSON.stringify({ utm_source: "reddit" })) },
    );

    expect((response as NextResponse).cookies.get(FIRST_TOUCH_COOKIE)).toBeUndefined();
  });

  // The campaign belongs to the landing page. A `?utm_source` on a deep link is somebody else's
  // query string and must not relabel the house.
  it("only runs on `/`", async () => {
    for (const path of ["/dashboard", "/setup", "/h/park-vista", "/styleguide"]) {
      const response = await stamp(`https://rota.monster${path}?utm_source=reddit`);

      expect((response as NextResponse).cookies.get(FIRST_TOUCH_COOKIE)).toBeUndefined();
    }
  });

  it("is httpOnly and scoped to the whole site", async () => {
    const response = await stamp("https://rota.monster/?ref=member");
    const cookie = (response as NextResponse).cookies.get(FIRST_TOUCH_COOKIE);

    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  // The wrapper adds a cookie to AuthKit's answer. It must never become the thing that decides
  // where a logged-out visitor goes.
  it("returns AuthKit's own response, redirect and all", async () => {
    const redirect = NextResponse.redirect("https://api.workos.com/user_management/authorize");

    const response = await stamp("https://rota.monster/?utm_source=reddit", {}, redirect);

    expect(response).toBe(redirect);
    expect((response as NextResponse).headers.get("location"))
      .toBe("https://api.workos.com/user_management/authorize");
    expect(firstTouchOn(response)).toEqual({ utm_source: "reddit" });
  });

  it("hands back an untouched response when there is nothing to record", async () => {
    const original = NextResponse.next();

    const response = await stamp("https://rota.monster/", {}, original);

    expect(response).toBe(original);
  });
});
