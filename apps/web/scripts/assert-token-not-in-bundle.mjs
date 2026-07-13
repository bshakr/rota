#!/usr/bin/env node
/**
 * The token-not-in-the-browser guarantee, asserted against the REAL built output.
 *
 * The member magic-link token arrives in the `/s/[token]` URL, is read in a Server
 * Component, and is forwarded to Rails only as an `Authorization: Bearer` header by
 * the `server-only` member API client. It must never reach the browser. Three
 * things enforce that, at three different moments:
 *
 *   1. `import "server-only"` in the token-handling modules — `next build` hard-fails
 *      if a Client Component imports one (build time, structural).
 *   2. bundle-safety.test.ts — asserts statically that no Client Component imports
 *      those modules and that each keeps its guard (unit test, fast).
 *   3. THIS script — greps the actual `.next/static` client chunks after the build,
 *      so even a leak the first two somehow missed trips a loud CI failure.
 *
 * This became meaningful only at BLO-1055: the member page is the first place that
 * consumes `@/lib/api/member`, so before it there was no build to grep. A token
 * VALUE never exists at build time (it's a runtime route param), so what we assert
 * is the only thing that CAN leak at build time — the token-handling CODE. If the
 * member API client or the shared Bearer-header builder is ever bundled into a
 * browser chunk, its distinctive strings (the `/api/member/*` paths, the `API_URL`
 * sentinel) come with it. Their absence is the token's absence.
 *
 * Runs after `next build` in `npm run ci` (see `check:bundle` in package.json).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATIC_DIR = join(WEB_ROOT, ".next", "static");

// Strings that appear ONLY in the server-only token-handling modules
// (src/lib/api/http.ts and src/lib/api/member.ts). String literals survive
// minification verbatim, so if either module is bundled client-side, one of these
// lands in a `.next/static` chunk. Chosen to be specific enough that no legitimate
// client code contains them: the browser reaches the member API exclusively through
// Server Actions, never a `/api/member/*` fetch of its own.
const FORBIDDEN = [
  "/api/member/", // member API client request paths
  "cannot reach the Rails API", // http.ts apiBaseUrl() error sentinel — the Bearer builder
];

/** Every `.js` the browser actually downloads (never `.map`, which isn't served). */
function clientChunks(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...clientChunks(full));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function fail(message) {
  console.error(`✗ token bundle safety: ${message}`);
  process.exit(1);
}

let files;
try {
  files = clientChunks(STATIC_DIR);
} catch {
  fail(`no ${relative(WEB_ROOT, STATIC_DIR)} directory — run \`next build\` before this check.`);
}

// A silent no-op (the glob broke, or the build produced nothing) would pass forever
// while asserting nothing. Refuse to.
if (files.length === 0) {
  fail("found no client chunks to scan — did the build actually run?");
}

const offenders = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const signature of FORBIDDEN) {
    if (source.includes(signature)) {
      offenders.push(`  ${relative(WEB_ROOT, file)} contains ${JSON.stringify(signature)}`);
    }
  }
}

if (offenders.length > 0) {
  fail(
    "token-handling code reached a client bundle — the magic-link token could leak to the browser:\n" +
      offenders.join("\n"),
  );
}

console.log(
  `✓ token bundle safety: scanned ${files.length} client chunks; no member API client or Bearer-token code present.`,
);
