import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for the auth plumbing and the two API clients. They exercise pure
// logic (the proxy matcher, error mapping) and the fetch/header construction of
// the clients with a mocked `fetch`, AuthKit and `next/navigation` — so a plain
// node environment is all they need. The heavier "does the member token ever
// reach the browser bundle" check is a post-build grep, not a unit test; it runs
// after `next build` in `npm run ci` (see scripts/assert-token-not-in-bundle.mjs).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real `server-only` marker throws unless resolved through Next's
      // `react-server` condition, which a plain node runner doesn't set. Stub it.
      "server-only": fileURLToPath(new URL("./src/test/server-only.stub.ts", import.meta.url)),
    },
  },
});
