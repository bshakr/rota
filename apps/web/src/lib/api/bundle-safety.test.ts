import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The token-not-in-bundle guarantee, asserted statically.
//
// The member token (and the admin JWT, and the API origin) must never reach the
// browser. Two mechanisms enforce that: `import "server-only"` at the top of each
// token-handling module (which makes `next build` hard-fail if a Client Component
// imports it), and the plain fact that no Client Component imports them. This test
// asserts BOTH — so a regression trips here in the fast unit suite, not only later
// in a production build once a page finally consumes the client.

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Modules that read the token / JWT / API origin. A Client Component importing any
// of these is exactly how the credential would end up in a browser chunk.
const SERVER_ONLY_MODULES = ["lib/api/http", "lib/api/member", "lib/api/admin"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function isClientModule(source: string): boolean {
  // The "use client" directive may sit after leading comments (e.g. a license
  // header), so strip those before checking — otherwise a commented file would be
  // mistaken for a server module and skip the guard.
  const withoutLeadingComments = source.replace(
    /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/,
    "",
  );
  return /^["']use client["']/.test(withoutLeadingComments);
}

function importSources(source: string): string[] {
  // Static `from "…"`, side-effect `import "…"`, and dynamic `import("…")`.
  return [
    ...source.matchAll(
      /from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3]);
}

describe("bundle safety: the member token never reaches the client", () => {
  const files = sourceFiles(SRC_ROOT);

  it("finds source files to scan (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no Client Component imports a server-only token-handling module", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) continue;
      for (const spec of importSources(source)) {
        if (SERVER_ONLY_MODULES.some((mod) => spec.includes(mod))) {
          offenders.push(`${file.replace(SRC_ROOT, "src/")} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every token-handling module keeps its `server-only` guard", () => {
    for (const mod of SERVER_ONLY_MODULES) {
      const source = readFileSync(join(SRC_ROOT, `${mod}.ts`), "utf8");
      expect(source.trimStart().startsWith('import "server-only";')).toBe(true);
    }
  });
});
