import * as Sentry from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent } from "@/lib/observability/scrub";

// The browser half of error reporting. Next runs this file after the document
// loads and before React hydrates, which is early enough to catch a failure during
// hydration itself.
//
// It lives at src/instrumentation-client.ts because this app uses a src directory;
// Next looks for the file at the project root or inside src, and Turbopack builds
// require this file rather than the older sentry.client.config.ts.
//
// This is a BROWSER entry point, so everything it imports ships to the browser.
// That is why src/lib/observability/scrub.ts carries no `server-only` guard and no
// secrets of its own: it is meant to be here, scrubbing the member's own URL out of
// their own breadcrumbs.

Sentry.init({
  // The one NEXT_PUBLIC_ variable in this repo. A DSN is a public, write-only
  // address, and events reach it through our own /monitoring tunnel; see
  // apps/web/README.md for why this single exception to "nothing is NEXT_PUBLIC_"
  // is safe.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // The browser can only read NEXT_PUBLIC_ values, and NODE_ENV is `production` on
  // Railway, so no second public variable is needed to gate development out. The
  // release comes from the build: withSentryConfig injects it into the client
  // bundle under the same name the source maps were uploaded with.
  environment: process.env.NODE_ENV,

  // Development never sends, matching the server gate and the Rails initialiser.
  // A DSN pasted into the root .env must not turn `npm run dev` into a page.
  // NODE_ENV is `production` for every deployed build, preview included.
  enabled: process.env.NODE_ENV === "production",

  sendDefaultPii: false,
  tracesSampleRate: 0,

  // Session Replay is a decided no, not an oversight: the admin and member pages
  // render names and phone numbers, and masking is not a good enough answer on a
  // product whose whole privacy story is that the number never leaves the server.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  initialScope: { tags: { app: "web", runtime: "browser" } },

  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

// Navigation breadcrumbs and (later) navigation spans. Exported so Next hands the
// SDK each client-side route change.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
