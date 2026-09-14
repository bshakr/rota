import * as Sentry from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent } from "@/lib/observability/scrub";

// The edge runtime half. Nothing of ours runs on the edge today: Next 16 runs
// src/proxy.ts on the Node runtime, and no route opts into the edge runtime. The
// file exists because the SDK's instrumentation contract expects a config per
// runtime, and because the day a route does opt in, the alternative is an edge
// function reporting nowhere.
//
// Kept deliberately identical to sentry.server.config.ts, minus the Node-only
// concerns, so the two cannot drift on the parts that matter (the DSN, the
// environment gate, the scrubber).

const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,
  release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  enabled: ["production", "preview"].includes(environment ?? ""),
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  initialScope: { tags: { app: "web", runtime: "edge" } },
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
