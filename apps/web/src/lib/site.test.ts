import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pageTitle,
  SITE_DESCRIPTION,
  SITE_TITLE,
  siteOrigin,
  siteUrl,
  TITLE_TEMPLATE,
} from "./site";

describe("site origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses APP_URL when the environment sets one", () => {
    vi.stubEnv("APP_URL", "https://preview.example.com");
    expect(siteOrigin()).toBe("https://preview.example.com");
    expect(siteUrl("/sitemap.xml")).toBe("https://preview.example.com/sitemap.xml");
  });

  // CI has no .env and still runs `next build`, which prerenders robots.txt,
  // sitemap.xml and the OG image. Without the fallback `new URL(undefined)` throws
  // and the build goes red, so this is the assertion that keeps CI green.
  it("falls back to the production domain when APP_URL is unset", () => {
    vi.stubEnv("APP_URL", undefined);
    expect(siteOrigin()).toBe("https://rota.monster");
    expect(siteUrl()).toBe("https://rota.monster/");
  });

  it("never doubles the slash when APP_URL carries a trailing one", () => {
    vi.stubEnv("APP_URL", "https://rota.monster/");
    expect(siteOrigin()).toBe("https://rota.monster");
    expect(siteUrl("/sitemap.xml")).toBe("https://rota.monster/sitemap.xml");
  });
});

describe("page titles", () => {
  it("renders the homepage title with the brand suffix", () => {
    expect(pageTitle(SITE_TITLE)).toBe("The chore rota that texts your housemates · Rota Monster");
  });

  // Google truncates a result title around 60 characters and a description
  // around 160. Both are written to fit, and a rewrite that overruns should fail
  // here rather than be discovered in a search result.
  it("keeps the title and description inside what a search result shows", () => {
    expect(pageTitle(SITE_TITLE).length).toBeLessThanOrEqual(60);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  // Next applies `title.template` to CHILD segments only, so `/` cannot use the
  // layout's template and applies the same string by hand. The two must not drift:
  // if someone edits the template in layout.tsx, the homepage title has to follow.
  it("hands Next the exact template the homepage applies by hand", () => {
    const layout = readFileSync(
      fileURLToPath(new URL("../app/layout.tsx", import.meta.url)),
      "utf8",
    );

    expect(layout).toMatch(/template:\s*TITLE_TEMPLATE/);
    expect(TITLE_TEMPLATE).toBe("%s · Rota Monster");
  });
});
