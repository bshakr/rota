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
 *   3. THIS script — greps the real build output after `next build`, so even a leak
 *      the first two somehow missed trips a loud CI failure.
 *
 * WHAT IT ASSERTS, precisely, in two passes over two different kinds of file:
 *
 *   A. `.next/static/**\/*.js` — every chunk the browser downloads — contains none
 *      of FORBIDDEN: the member API client's request paths, the Bearer-header
 *      builder's error sentinel, the super admin API paths, and the name of the
 *      super admin allowlist variable. This is a check on CODE placement.
 *
 *   B. `.next/server/app/**\/*.{html,rsc}` — the prerendered markup and flight
 *      payloads, which are also served to browsers — contains no trace of the
 *      allowlist: its variable name always, and each configured id as well when
 *      the variable is set in this environment. This is a check on VALUES, and it
 *      is a different vector from A: those files are produced by server code,
 *      where the allowlist legitimately exists.
 *
 * What it does NOT assert: anything about a per-request dynamic render. See the
 * scope note below.
 *
 * This became meaningful only at BLO-1055: the member page is the first place that
 * consumes `@/lib/api/member`, so before it there was no build to grep. A token
 * VALUE never exists at build time (it's a runtime route param), so this checks the
 * one thing that CAN leak at build time — the token-handling CODE. If the member
 * API client or the shared Bearer-header builder is ever bundled into a browser
 * chunk, its distinctive strings (the `/api/member/*` paths, the `API_URL` sentinel)
 * come with it.
 *
 * SCOPE, stated honestly: pass A proves the server-only CODE isn't in a static
 * client chunk, and pass B proves the allowlist isn't in anything the build
 * prerendered. Neither can catch a value rendered into a DYNAMIC route's
 * per-request RSC/flight payload — the member page is force-dynamic and nothing
 * of it is prerendered, and `/super-admin` is dynamic too. That runtime vector,
 * the higher-risk one for the token, is covered separately by
 * page.token-safety.test.ts, which renders the page with a sentinel token and
 * asserts it appears in no client-bound prop. The corresponding guard for the
 * allowlist is structural: `src/lib/auth/super-admin.ts` is `server-only`, the
 * shells take a BOOLEAN rather than the ids, and bundle-safety.test.ts asserts
 * both. The pieces together are the guarantee; any one alone is not.
 *
 * Runs after `next build` in `npm run ci` (see `check:bundle` in package.json).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATIC_DIR = join(WEB_ROOT, ".next", "static");

// Strings that appear ONLY in the server-only modules — the token-handling pair
// (src/lib/api/http.ts, src/lib/api/member.ts) and the super admin seam
// (src/lib/auth/super-admin.ts, src/lib/api/super-admin.ts). String literals
// survive minification verbatim, so if any of them is bundled client-side, one of
// these lands in a `.next/static` chunk. Chosen to be specific enough that no
// legitimate client code contains them: the browser reaches the member API
// exclusively through Server Actions, never a `/api/member/*` fetch of its own,
// and it reaches the super admin API not at all.
const FORBIDDEN = [
  "/api/member/", // member API client request paths
  "cannot reach the Rails API", // http.ts apiBaseUrl() error sentinel — the Bearer builder
  // The operator allowlist. It is read by name in src/lib/auth/super-admin.ts,
  // and `process.env.SUPER_ADMIN_WORKOS_USER_IDS` is left intact for the server
  // runtime (Next inlines only NEXT_PUBLIC_* vars), so the variable name riding
  // into a client chunk means the module itself went with it — and with it the
  // question of who can open HQ. The shells take a boolean from their layout
  // precisely so this never happens.
  "SUPER_ADMIN_WORKOS_USER_IDS",
  "/api/super_admin/", // super admin API client request paths
];

// The PRERENDERED OUTPUT is served to browsers too, and it is a second place the
// allowlist could surface. `.next/server/app/**/*.html` is the HTML a statically
// generated route ships; the matching `.rsc` is the flight payload the router
// fetches for that route. Both are sent verbatim to a browser, and unlike a
// client chunk they are produced by SERVER code — where the allowlist legitimately
// exists — so a Server Component that rendered an id into its markup, or handed
// one to a Client Component as a prop, would land it here and nowhere else.
//
// Scanned for the allowlist only. The member token has no build-time value to
// find (it is a runtime route param on a force-dynamic page), which is why that
// half of the guarantee stays with page.token-safety.test.ts.
const PRERENDER_DIR = join(WEB_ROOT, ".next", "server", "app");
const PRERENDER_EXTENSIONS = [".html", ".rsc"];

// The variable NAME catches the module travelling somewhere it should not. When
// the variable is actually SET in this environment — locally, and on any CI that
// sets it — each id is searched for as well, which is the check that would catch
// a real value rendered into a page. With it unset there is no value to look for
// and only the name check runs; that is the honest scope, not a silent pass.
const ALLOWLIST_VAR = "SUPER_ADMIN_WORKOS_USER_IDS";
const ALLOWLIST_SIGNATURES = [
  ALLOWLIST_VAR,
  ...(process.env[ALLOWLIST_VAR] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
];

/** Files under `dir` whose extension is in `extensions`, recursively. */
function filesWithin(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesWithin(full, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

/** Every `.js` the browser actually downloads (never `.map`, which isn't served). */
function clientChunks(dir) {
  return filesWithin(dir, [".js"]);
}

function fail(message) {
  console.error(`✗ token bundle safety: ${message}`);
  process.exit(1);
}

function scan(files, signatures) {
  const found = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const signature of signatures) {
      if (source.includes(signature)) {
        found.push(`  ${relative(WEB_ROOT, file)} contains ${JSON.stringify(signature)}`);
      }
    }
  }
  return found;
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

const offenders = scan(files, FORBIDDEN);

if (offenders.length > 0) {
  fail(
    "token-handling code reached a client bundle — the magic-link token could leak to the browser:\n" +
      offenders.join("\n"),
  );
}

let prerendered;
try {
  prerendered = filesWithin(PRERENDER_DIR, PRERENDER_EXTENSIONS);
} catch {
  fail(`no ${relative(WEB_ROOT, PRERENDER_DIR)} directory — run \`next build\` before this check.`);
}

// Every build prerenders something (the 404 page at the very least), so an empty
// result means the layout of the build output moved and this half is asserting
// nothing. Same reasoning as the client-chunk guard above.
if (prerendered.length === 0) {
  fail(
    `found no .html/.rsc files under ${relative(WEB_ROOT, PRERENDER_DIR)} — did the build output move?`,
  );
}

const leaked = scan(prerendered, ALLOWLIST_SIGNATURES);

if (leaked.length > 0) {
  fail(
    "the super admin allowlist reached prerendered output that is served to browsers:\n" +
      leaked.join("\n"),
  );
}

const valueCheck =
  ALLOWLIST_SIGNATURES.length > 1
    ? `name and ${ALLOWLIST_SIGNATURES.length - 1} configured id(s)`
    : "name only (the variable is unset here, so there is no value to look for)";

console.log(
  `✓ token bundle safety: scanned ${files.length} client chunks — no member API client or Bearer-token code, ` +
    `no super admin API paths, no allowlist variable.\n` +
    `✓ allowlist: scanned ${prerendered.length} prerendered .html/.rsc files for the allowlist ${valueCheck}; none present.`,
);
