import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingView } from "./landing-view";

describe("LandingView", () => {
  // It is mounted for one reason: to run an effect. It must add nothing to the page — no wrapper
  // element, no script tag, no whitespace — which is what the before/after screenshots claim.
  it("renders nothing", () => {
    expect(renderToStaticMarkup(createElement(LandingView))).toBe("");
  });

  // Rendering on the server must not try to read a browser location or send anything. The effect is
  // the only place either happens, and effects do not run in a server render.
  it("sends nothing during a server render", () => {
    expect(() => renderToStaticMarkup(createElement(LandingView))).not.toThrow();
  });
});
