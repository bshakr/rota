import { notFound } from "next/navigation";

// TEMPORARY. Delete this route, and the src/app/debug directory with it, once one
// server event and one browser event have been seen in the production Sentry
// project. A page that throws on demand does not belong in a shipped product, even
// behind a login (docs/sentry-error-logging.md §7.9 and the §10 checklist).
//
// What it proves, in one visit while signed in as an admin:
//
//   - The server event: the throw happens during a Server Component render, so
//     Next hands it to onRequestError in src/instrumentation.ts, which reports it
//     with routeType "render".
//   - The browser event: src/app/error.tsx catches the same failure on the client
//     and reports it through the /monitoring tunnel, which is what proves the
//     tunnel route and the proxy matcher exclusion both work.
//   - Both carry the same `digest`, so the two events are one story.
//
// Two guards, and the first is the one that matters: the page does not exist unless
// SENTRY_SMOKE=1 is set on the service. Set it, visit the route, see both events,
// then unset it — a deploy that forgets to unset it still answers 404 to everyone,
// because the second guard is the route itself: /debug/sentry-smoke sits under the
// AuthKit proxy matcher, so an anonymous visitor is sent to WorkOS sign-in and never
// reaches the throw. SENTRY_SMOKE is read on the server, so it is a plain runtime
// variable and nothing about this page reaches the browser bundle.

// force-dynamic, or `next build` would prerender this page, hit the throw and fail
// the build. The failure must happen on a request, not during the build.
export const dynamic = "force-dynamic";

export default function SentrySmokePage() {
  if (process.env.SENTRY_SMOKE !== "1") notFound();

  throw new Error("sentry smoke: web");
}
