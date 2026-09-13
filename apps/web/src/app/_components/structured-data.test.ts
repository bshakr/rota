import { afterEach, describe, expect, it, vi } from "vitest";

import { buildStructuredData, toJsonLd } from "./structured-data";

/** Every string anywhere in the value, however deeply nested. */
function walkKeys(value: unknown, seen: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, seen);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      seen.push(key);
      walkKeys(child, seen);
    }
  }
  return seen;
}

describe("homepage structured data", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds every URL from the origin it is given", () => {
    const json = JSON.stringify(buildStructuredData("https://staging.example.com"));

    expect(json).not.toContain("rota.monster");
    for (const url of json.match(/https?:\/\/[^"]+/g) ?? []) {
      // schema.org is the vocabulary, not one of our pages.
      if (url.startsWith("https://schema.org")) continue;
      expect(url.startsWith("https://staging.example.com/")).toBe(true);
    }
  });

  it("takes the origin from APP_URL, and falls back to the production domain", () => {
    vi.stubEnv("APP_URL", "https://preview.example.com");
    expect(JSON.stringify(buildStructuredData())).toContain("https://preview.example.com/#org");

    vi.stubEnv("APP_URL", undefined);
    expect(JSON.stringify(buildStructuredData())).toContain("https://rota.monster/#org");
  });

  // The reason this module exists. An `offers` block is a price claim, and Google
  // treats an inaccurate one as a manual-action risk; no spec records a price, so
  // there must not be one until pricing is decided.
  it("claims no price: no offers block anywhere in the graph", () => {
    const graph = buildStructuredData("https://rota.monster");

    expect(walkKeys(graph)).not.toContain("offers");
    expect(JSON.stringify(graph)).not.toContain("priceCurrency");
  });

  it("marks up no FAQ, because the page shows none", () => {
    expect(JSON.stringify(buildStructuredData("https://rota.monster"))).not.toContain("FAQPage");
  });

  it("describes the three things the page is: an org, a site and the app", () => {
    const graph = buildStructuredData("https://rota.monster") as {
      "@graph": { "@type": string }[];
    };

    expect(graph["@graph"].map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
    ]);
  });

  it("serialises to something a crawler can actually parse", () => {
    const serialised = toJsonLd(buildStructuredData("https://rota.monster"));

    expect(() => JSON.parse(serialised)).not.toThrow();
    expect(JSON.parse(serialised)).toEqual(buildStructuredData("https://rota.monster"));
  });

  // A `<` in any string value would let a payload close the <script> element it is
  // rendered into. Escaped it stays valid JSON and parses back unchanged.
  it("escapes < so no value can close the script element", () => {
    const serialised = toJsonLd({ name: "</script><img onerror=alert(1)>" });

    expect(serialised).not.toContain("</script>");
    expect(serialised).toContain("\\u003c/script");
    expect(JSON.parse(serialised)).toEqual({ name: "</script><img onerror=alert(1)>" });
  });
});
