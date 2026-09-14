import * as Sentry from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent } from "@/lib/observability/scrub";

// The Node runtime half of error reporting: Server Components, Route Handlers,
// Server Actions and src/proxy.ts all report through here, via the onRequestError
// hook in src/instrumentation.ts.
//
// This file lives beside next.config.ts rather than under src/ because
// src/instrumentation.ts imports it by path at runtime, and because it is not
// application code: nothing in src/ may import it.
//
// It must be safe to load with no Sentry variables set at all. With no DSN the SDK
// initialises into a disabled client, every `Sentry.*` call becomes a no-op, and
// `npm run ci` and `npm run dev` behave exactly as they did before this landed.

const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,

  // The same string Rails reports, and the same string the source maps were
  // uploaded under at build time. Railway injects RAILWAY_GIT_COMMIT_SHA into both.
  release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,

  // Development stays silent even with a DSN pasted into the root .env, so a local
  // experiment never pages anybody. Set SENTRY_ENVIRONMENT=preview to exercise the
  // wire on purpose.
  enabled: ["production", "preview"].includes(environment ?? ""),

  // Never. PII here means the AuthKit session cookie, the admin's email and the
  // member's phone number. The user is set by hand, id only, in the admin layout.
  sendDefaultPii: false,

  // Errors only for now. Tracing is a later decision and it costs quota.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),

  initialScope: { tags: { app: "web" } },

  // The privacy contract's last line of defence. See src/lib/observability/scrub.ts.
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
