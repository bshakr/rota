import "server-only";

import { buildApiError } from "./errors";

// The one fetch both API clients go through. It attaches the bearer token as a
// header (never the URL — see the member client), reaches Rails at `API_URL`,
// and turns any non-2xx into a typed `ApiError`. `server-only`: the token and the
// base URL never belong in a client bundle.

/** The Rails API origin, read at call time so a static prerender can't freeze a stale value. */
export function apiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      "API_URL is not set — the web app cannot reach the Rails API. Set it in the repo-root .env (see .env.example).",
    );
  }
  return url.replace(/\/+$/, "");
}

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Serialized as JSON when present; sets Content-Type. `undefined` sends no body. */
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Perform an authenticated JSON request and return the parsed body as `T`.
 *
 * `token` is placed in `Authorization: Bearer …` and nowhere else. `path` is a
 * fixed API path (e.g. `/api/member/shifts`) with no secret in it. Throws
 * `ApiError` on any non-2xx so callers can switch on `error.code`.
 */
export async function requestJson<T>(
  path: string,
  token: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  const hasBody = init.body !== undefined;
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    // Every response is per-user and auth-scoped; never let Next's fetch cache
    // serve one admin's data to another, or a stale list after a mutation.
    cache: "no-store",
  });

  if (!response.ok) {
    throw buildApiError(response.status, await safeJson(response));
  }

  // Parse via text() so an empty 2xx body (204, or an endpoint that returns no
  // content) yields undefined rather than throwing a SyntaxError the caller can't
  // switch on. Callers type those responses as void.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
