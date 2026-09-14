import type { Breadcrumb, Event } from "@sentry/nextjs";

// The last line of defence between a member's credentials and Sentry.
//
// The privacy contract (docs/sentry-error-logging.md §3) is that no member access
// token, phone number, WorkOS JWT or AuthKit session cookie ever leaves this app.
// The SDK is configured not to collect them, but "configured not to" is one
// refactor away from "collects"; an exception message, a breadcrumb or a URL can
// carry any of them without anybody deciding it should. So every event and every
// breadcrumb is rewritten here first, on both runtimes.
//
// Deliberately dependency-free and NOT `server-only`: this module runs in the
// browser too (src/instrumentation-client.ts), which is precisely where the
// `/s/<token>` URL and the navigation breadcrumbs live. It handles no secret of
// its own, so nothing leaks by shipping it.
//
// The same four rewrites exist in Ruby in apps/api/app/lib/sentry_scrubber.rb, and
// the same four fixtures are asserted there. Two languages, two files, one
// contract: change one and change the other.

/** Twilio's own error messages quote the destination number verbatim. */
const E164 = /\+[1-9]\d{6,14}/g;

/** The magic link. The token is a permanent bearer credential and never expires. */
const MAGIC_LINK = /\/s\/[A-Za-z0-9_-]{20,}/g;

/** Any Authorization header value that reached a breadcrumb, a header map or a message. */
const BEARER = /\bBearer\s+\S+/gi;

// A bare 32-byte URL-safe token, the shape `Member#access_token` has. The first
// three rules miss it when it stands on its own (a log-derived breadcrumb, an
// exception message that quotes only the token). Lookarounds rather than `\b`:
// `-` is not a word character, so `\b` would happily match inside a longer run.
const BARE_TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

/**
 * Rewrite every known credential shape out of one string.
 *
 * Order matters: `Bearer …` is collapsed before the bare-token rule can eat its
 * payload, and the magic link is matched before the bare token so the surviving
 * text still says a link was involved.
 */
export function scrubString(value: string): string {
  return value
    .replace(BEARER, "Bearer [filtered]")
    .replace(MAGIC_LINK, "/s/[token]")
    .replace(E164, "[phone]")
    .replace(BARE_TOKEN, "[token]");
}

/**
 * Rewrite a URL. Same rules as `scrubString`; named separately because the URL is
 * the one field where a leak is certain rather than possible, and callers should
 * be able to say what they mean.
 */
export function scrubUrl(url: string): string {
  return scrubString(url);
}

// Request headers that are a credential in their entirety. The SDK's own deny
// list should stop these arriving; deleting them here means a change to that
// config cannot quietly undo the contract.
const FORBIDDEN_HEADERS = new Set(["cookie", "authorization"]);

/**
 * Walk anything and rewrite every string in it, in place where the container
 * allows. Events carry credentials in places a field list never quite covers:
 * `contexts`, `extra`, a breadcrumb's `data`, a tag value, a stack frame's
 * module path. Walking everything is what makes the test assertion ("the
 * serialised event contains none of the four fixtures") true by construction
 * rather than by a field list somebody has to remember to extend.
 */
function scrubDeep<T>(value: T, seen: WeakSet<object>): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (value === null || typeof value !== "object") return value;

  const container = value as unknown as object;
  // Sentry events are plain data, but a `cause` chain or a custom context can be
  // cyclic, and a stack overflow inside beforeSend drops the event silently.
  if (seen.has(container)) return value;
  seen.add(container);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = scrubDeep(value[i], seen);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    record[key] = scrubDeep(record[key], seen);
  }
  return value;
}

/**
 * `beforeSend` for both runtimes. Deletes the credentials that have no scrubbed
 * form worth keeping, then rewrites every remaining string in the event.
 *
 * Returns the event so it is sent; this scrubber never drops an event, because a
 * dropped event is an error nobody sees, which is the failure this whole exercise
 * exists to prevent.
 */
export function scrubEvent<E extends Event>(event: E): E {
  const request = event.request;
  if (request) {
    // The AuthKit session cookie (`wos-session`) is a live credential, and there
    // is nothing in the cookie jar worth an event. `sendDefaultPii: false` should
    // already have stopped it; this is the belt to that pair of braces.
    delete request.cookies;

    const headers = request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        if (FORBIDDEN_HEADERS.has(name.toLowerCase())) delete headers[name];
      }
    }
  }

  return scrubDeep(event, new WeakSet());
}

/**
 * `beforeBreadcrumb` for both runtimes. Navigation breadcrumbs record the URL the
 * browser came from and went to, which on a member's phone is `/s/<token>` both
 * times, so this one matters as much as the event scrubber.
 */
export function scrubBreadcrumb<B extends Breadcrumb>(breadcrumb: B): B {
  return scrubDeep(breadcrumb, new WeakSet());
}
