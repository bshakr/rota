import { resolve } from "node:path";

import { config as loadRootEnv } from "dotenv";
import type { NextConfig } from "next";

// The monorepo keeps ONE .env, at its root. Rails already points dotenv there
// (apps/api/config/application.rb); this is the Next half of the same deal.
//
// Next only auto-loads .env files sitting in its OWN directory, so without this
// line apps/web sees none of API_URL, APP_URL or the WORKOS_* keys — and it does
// so silently, as `undefined`, rather than loudly. npm runs scripts with the
// package directory as cwd, so ../../ is the repo root for `next dev`, `next
// build` and `next start` alike.
//
// Nothing is re-exported through Next's `env` config key, deliberately: that key
// inlines values into the CLIENT bundle at build time, which for WORKOS_API_KEY
// would mean shipping a secret to the browser. Server Components and Route
// Handlers read process.env directly, in this same process, which is the only
// place these belong.
//
// In CI there is no .env — it is gitignored — so dotenv no-ops there and the
// build must still pass without it. It does: nothing here is read at build time.
loadRootEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {};

export default nextConfig;
