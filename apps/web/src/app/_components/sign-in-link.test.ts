import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_HREF } from "@/lib/site";

import { SignInLink } from "./sign-in-link";

const sendBeacon = vi.fn();

beforeEach(() => {
  sendBeacon.mockReset().mockReturnValue(true);
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { sendBeacon });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The element the component returns, so its onClick can be invoked without a DOM. */
function click(props: Parameters<typeof SignInLink>[0], event = {} as never) {
  const element = SignInLink(props) as { props: { onClick: (event: never) => void } };
  element.props.onClick(event);
}

async function sent(): Promise<Array<{ name: string; properties: Record<string, unknown> }>> {
  const blobs = sendBeacon.mock.calls.map((call) => call[1] as Blob);

  return Promise.all(blobs.map(async (blob) => JSON.parse(await blob.text())));
}

describe("SignInLink", () => {
  // The whole claim of this change: the page renders exactly what it rendered before. An onClick
  // puts nothing in the HTML, so the before/after capture is byte-identical.
  it("renders the same plain anchor, with no extra attribute", () => {
    const markup = renderToStaticMarkup(
      createElement(SignInLink, { position: "header", href: SIGN_IN_HREF, className: "pill" }, "Sign in"),
    );

    expect(markup).toBe('<a href="/dashboard" class="pill">Sign in</a>');
  });

  it("records which call to action was pressed", async () => {
    click({ position: "hero", href: SIGN_IN_HREF });

    await expect(sent()).resolves.toEqual([
      { name: "cta_click", properties: { position: "hero" } },
      { name: "signin_started", properties: { position: "hero" } },
    ]);
  });

  it("names all three positions the page has", async () => {
    for (const position of ["hero", "closing", "header"] as const) {
      sendBeacon.mockClear();
      click({ position, href: SIGN_IN_HREF });

      expect((await sent())[0]).toEqual({ name: "cta_click", properties: { position } });
    }
  });

  // Derived from the href rather than assumed, so a CTA that one day points at a demo or a pricing
  // page stops claiming a sign-in it never started.
  it("claims a sign-in only when the link really is the hand-off", async () => {
    click({ position: "hero", href: "/demo" });

    await expect(sent()).resolves.toEqual([{ name: "cta_click", properties: { position: "hero" } }]);
  });

  // `Button asChild` composes handlers through Radix's Slot. Measuring must not swallow whatever
  // the button wanted to do.
  it("still calls a handler passed down to it", () => {
    const onClick = vi.fn();

    click({ position: "closing", href: SIGN_IN_HREF, onClick });

    expect(onClick).toHaveBeenCalledOnce();
  });

  // Nothing here may delay or block the navigation: no preventDefault, no await, no promise the
  // browser waits on.
  it("never prevents the navigation", () => {
    const preventDefault = vi.fn();

    click({ position: "hero", href: SIGN_IN_HREF }, { preventDefault } as never);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
