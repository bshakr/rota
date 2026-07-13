import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { proxyMatches, PROXY_MATCHER } from "./proxy-matcher";

describe("AuthKit proxy matcher", () => {
  // The whole point of the member path. `/s/<token>` is public and authenticates
  // by the member token, not a WorkOS session; if the proxy ever intercepts it,
  // every SMS link we send is broken. This is the assertion the ticket demands.
  it("NEVER intercepts the member magic-link route", () => {
    expect(proxyMatches("/s/demo-token")).toBe(false);
    expect(proxyMatches("/s/6f1e2d3c4b5a69788796a5b4c3d2e1f0")).toBe(false);
    expect(proxyMatches("/s/any/deeper/path")).toBe(false);
  });

  it("does not intercept the OAuth callback (handleAuth owns its cookies)", () => {
    expect(proxyMatches("/callback")).toBe(false);
  });

  it("does not intercept framework internals or static files", () => {
    expect(proxyMatches("/_next/static/chunk.js")).toBe(false);
    expect(proxyMatches("/favicon.ico")).toBe(false);
    expect(proxyMatches("/icon.svg")).toBe(false);
  });

  it("runs on every admin route so withAuth() is covered by the proxy", () => {
    for (const path of [
      "/",
      "/dashboard",
      "/members",
      "/members/12",
      "/rotas",
      "/rotas/3/edit",
      "/shifts",
      "/sms",
    ]) {
      expect(proxyMatches(path)).toBe(true);
    }
  });

  it("exposes the matcher as a string for Next's config", () => {
    expect(typeof PROXY_MATCHER).toBe("string");
    expect(PROXY_MATCHER.startsWith("/(")).toBe(true);
  });

  // Next requires `config.matcher` to be an inline literal (it is statically
  // parsed), so proxy.ts can't import PROXY_MATCHER. This keeps the two honest:
  // the literal shipped to Next must be exactly the pattern these tests exercise.
  it("proxy.ts ships the exact pattern this suite verifies", () => {
    const proxySource = readFileSync(
      fileURLToPath(new URL("../../../proxy.ts", import.meta.url)),
      "utf8",
    );
    const inlineLiteral = proxySource.match(/matcher:\s*\[\s*"([^"]*)"\s*\]/)?.[1];
    const canonicalLiteral = readFileSync(
      fileURLToPath(new URL("./proxy-matcher.ts", import.meta.url)),
      "utf8",
    ).match(/PROXY_MATCHER\s*=\s*"([^"]*)"/)?.[1];

    expect(inlineLiteral).toBeDefined();
    expect(inlineLiteral).toBe(canonicalLiteral);
  });
});
