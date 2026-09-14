import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// The monorepo keeps ONE .env, at its root. Rails already points its loader there
// (apps/api/config/application.rb); this is the Next half of the same deal.
//
// Loaded three ways that matter, none left to chance:
//
//   - `@next/env`'s loadEnvConfig is the SAME loader Next uses internally, so the
//     root .env is parsed with identical semantics (.env / .env.local, NODE_ENV
//     variants, quoting) to a .env sitting in this directory. Raw dotenv would
//     diverge on the details.
//
//   - The path is resolved from THIS FILE, not process.cwd(). `next build`,
//     `next start`, `next typegen` and an editor's TS server can each run from a
//     different working directory; anchoring on import.meta.url makes "../.."
//     mean the repo root regardless.
//
//   - It must not THROW when the file is absent. `next typegen` and CI both load
//     this config, and CI has no .env (it is gitignored). loadEnvConfig no-ops on
//     a missing file, so the config stays importable — a throw here would break
//     typegen and the build, not merely runtime env.
//
// Nothing is re-exported through Next's `env` key, deliberately: that inlines
// values into the CLIENT bundle at build time, which for WORKOS_API_KEY means
// shipping a secret to the browser. Server Components and Route Handlers read
// process.env directly, in this process, which is the only place these belong.
//
// forceReload (the 4th arg) is REQUIRED and easy to miss: Next calls
// loadEnvConfig for THIS directory before it imports the config, and the loader
// caches after the first call, so a plain second call for the repo root is a
// silent no-op — env comes back undefined. forceReload re-parses from repoRoot;
// later internal no-op calls then leave our values in place.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isDev = process.env.NODE_ENV !== "production";
loadEnvConfig(repoRoot, isDev, console, true);

const nextConfig: NextConfig = {};

// Sentry wraps the config rather than replacing it: everything above still runs,
// and the wrapper only adds the build-time half of error reporting (source-map
// upload and the tunnel route). The runtime half lives in sentry.server.config.ts,
// sentry.edge.config.ts and src/instrumentation-client.ts.
//
// `withSentryConfig` is imported from "@sentry/nextjs/config" rather than
// "@sentry/nextjs": the re-export on the main entry is deprecated in SDK 10 and is
// removed in 11, and the main entry would drag the whole server SDK into the config.
//
// Every option here has to survive a build with NO Sentry variables at all, which
// is exactly what CI runs.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  sourcemaps: {
    // CI and local builds have no auth token: the upload is skipped rather than
    // attempted and failed, so `npm run ci` passes without a Sentry account.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Upload, then delete. .next/static is served to the public and our source maps
    // are the one artefact that would hand a reader the unminified app.
    deleteSourcemapsAfterUpload: true,
  },

  // Railway injects RAILWAY_GIT_COMMIT_SHA at build AND at runtime, so the release
  // the maps are uploaded under is the release the running app reports. Both apps
  // use the same string, so one deploy reads as one deploy across both projects.
  release: { name: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA },

  // Browser events are POSTed to our own origin and forwarded server-side. Ad
  // blockers block sentry.io by default, and an admin running uBlock on a laptop is
  // exactly our user. The path is excluded from the AuthKit proxy matcher in
  // src/proxy.ts, or every event POST would be redirected to WorkOS sign-in.
  tunnelRoute: "/monitoring",

  // Without this, a stack frame inside a dependency or Next internals stays minified.
  widenClientFileUpload: true,

  // No build telemetry to Sentry, and no build log noise unless CI is watching.
  telemetry: false,
  silent: !process.env.CI,
});
