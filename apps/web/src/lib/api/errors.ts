// The one error contract for both API clients.
//
// Every failure the Rails API returns carries a machine-readable `error` code as
// its first-class field (see apps/api ApiErrorRendering, Authenticatable,
// MemberCoversController, Rack::Attack). The web app switches on that code and
// falls back to the human `message` — it never parses prose. This module turns a
// non-2xx response into a typed `ApiError`, and maps any error to the one line a
// toast or an inline message should show.
//
// Deliberately framework-neutral: no `server-only`, no `sonner`. A server client
// throws it, a server action returns `.toBody()` across the RSC boundary, and a
// client component maps it to a toast (see ./toast) — all from the same source.

/** The JSON shape every Rails error shares. `error` is always present; the rest ride along. */
export interface ApiErrorBody {
  error: string;
  message?: string;
  /** ActiveModel's attribute → messages map, for putting an error back beside its input. */
  fields?: Record<string, string[]>;
  /** Extras such as `warning` (timezone/schedule changes) or `detail`. */
  [key: string]: unknown;
}

/** The member cover mutation's rejection codes (apps/api MemberCoversController::ERROR_MESSAGES). */
export type MemberCoverErrorCode =
  | "past_shift"
  | "not_responsible"
  | "cover_unavailable"
  | "self_cover"
  | "already_assignee"
  | "not_covered"
  | "not_original_assignee";

/**
 * A failed API call. `code` is the string to switch on, `message` the sentence to
 * show, `fields` the per-attribute validation errors when there are any, and
 * `body` the whole parsed payload so callers can read extras (`warning`, etc.).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string[]>;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? body.error ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error ?? "unknown_error";
    this.fields = body.fields;
    this.body = body;
  }

  is(code: string): boolean {
    return this.code === code;
  }

  /** A plain, structured object — serializable across a server action → client boundary. */
  toBody(): ApiErrorBody {
    return this.body;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

// When Rails does return a body it is always the structured shape; this only
// fires for the pathological cases — an HTML 500, an empty 502, a proxy timeout —
// where there is no `error` code to trust.
function synthesiseCode(status: number): string {
  if (status >= 500) return "server_error";
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  return "request_failed";
}

/** Build an `ApiError` from a status and whatever the response body parsed to. */
export function buildApiError(status: number, rawBody: unknown): ApiError {
  if (isApiErrorBody(rawBody)) {
    return new ApiError(status, rawBody);
  }
  return new ApiError(status, { error: synthesiseCode(status) });
}

// Copy for the codes Rails returns with no `message` of its own — the bodiless
// 401/404/429/503 and the two request-shape errors. Codes that always arrive with
// a human message (validation_failed, the domain and cover codes) intentionally
// aren't here: their server message is better than anything generic.
const FRIENDLY_MESSAGES: Record<string, string> = {
  unauthorized: "Your session has expired. Please sign in again.",
  not_found: "We couldn't find what you were looking for.",
  service_unavailable: "The service is briefly unavailable. Please try again in a moment.",
  too_many_requests: "Too many attempts. Please wait a moment and try again.",
};

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

function errorBodyOf(value: unknown): ApiErrorBody | null {
  if (isApiError(value)) return value.body;
  if (isApiErrorBody(value)) return value;
  return null;
}

/**
 * The one line to show for an error, whether it arrived as a thrown `ApiError`,
 * a plain body returned from a server action, or something unexpected. Server
 * message first (it is specific), then friendly copy for bodiless codes, then the
 * caller's own fallback, then a generic sentence.
 */
export function apiErrorMessage(error: unknown, fallback?: string): string {
  const body = errorBodyOf(error);
  if (body) {
    const serverMessage = body.message?.trim();
    if (serverMessage) return serverMessage;
    const friendly = FRIENDLY_MESSAGES[body.error];
    if (friendly) return friendly;
  }
  return fallback ?? GENERIC_MESSAGE;
}
