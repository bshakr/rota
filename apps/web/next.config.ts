import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
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

export default nextConfig;
