import * as Sentry from "@sentry/nextjs";

// Next's server instrumentation entry point. `register()` runs once per server
// instance, before the first request is handled, and is the only place a runtime
// gets to initialise an SDK that must be present from the first error onwards.
//
// The two configs are imported dynamically and per runtime on purpose: the Node
// SDK must not be pulled into an edge bundle, and NEXT_RUNTIME is the documented
// way to tell them apart (see node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation.md).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

// Every server-side error Next catches arrives here: Server Component renders,
// Route Handlers, Server Actions and proxy.ts, each tagged with its own
// `routeType`. Next 16 does not auto-instrument proxy.ts the way the SDK once
// wrapped middleware.ts, so this hook is what covers it.
//
// `captureRequestError` is the SDK's own implementation of the hook's contract,
// including reading the error's `digest` so a server event and the browser event
// that error.tsx reports for the same failure can be joined.
export const onRequestError = Sentry.captureRequestError;
