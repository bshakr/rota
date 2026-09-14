import { isApiError } from "./errors";

// "Is this house paused?", asked of an API answer.
//
// A suspended house (https://linear.app/bloombase/issue/BLO-1675) says so in two
// different ways, because the two audiences are asking different questions:
//
//   - the house's own admin API REFUSES, 403 `{ "error": "group_suspended" }`,
//     on every route except `/api/me` — which stays open precisely so the web app
//     can still learn the house's NAME to put on the paused screen;
//   - the member and public paths ANSWER, 200, with a top-level `"paused": true`
//     in place of the payload, because a housemate who followed a link from a
//     text is owed a sentence rather than an error page. The one write among them
//     — taking a cover — is refused with the same 403 the admin side uses.
//
// One rule holds both together: a top-level `paused` is present if and only if
// the house is suspended. It is NEVER sent as `false`. So absence is the answer
// for a live house, and nothing has to be threaded through the happy path.
//
// Both checks live here, together, because they are one fact with two spellings
// and three pages ask about it. Pure, framework-neutral, no `server-only`: a
// server component switches on them and a unit test exercises them directly.

/** The `error` code Rails sends when a suspended house refuses a request. */
export const GROUP_SUSPENDED = "group_suspended";

/**
 * Did this failure happen because the house is paused?
 *
 * The CODE, never the status: 403 alone is not the question (a future rule could
 * refuse for another reason entirely), and the code is the field the whole error
 * contract is built on — see ./errors.ts.
 *
 * A non-error, a network failure, or any other `ApiError` answers false, so a
 * caller can put this first in a catch and re-throw everything else untouched.
 */
export function isGroupSuspended(error: unknown): boolean {
  return isApiError(error) && error.code === GROUP_SUSPENDED;
}

/** A 200 that says the house is paused, in place of whatever was asked for. */
export interface PausedPayload {
  paused: true;
  /** Present on the member path, so the screen can name the house. Absent on some surfaces. */
  house?: { name: string };
}

/**
 * Is this answer the paused shape rather than the payload?
 *
 * Strictly `=== true`. A JSON body is untyped at the edge, and a truthiness test
 * would make the string "false", the number 0's absence, or any stray value mean
 * "paused" — which on this surface means replacing a working rota with a notice
 * that the house has been switched off. The one value Rails sends is `true`.
 */
export function isPaused<T extends object>(payload: T | PausedPayload): payload is PausedPayload {
  return (payload as { paused?: unknown }).paused === true;
}

/**
 * The house's name out of a paused answer, when it carried one.
 *
 * `GET /public/households/:slug` keeps its `household` key and adds `paused`
 * beside it; the member path replaces its payload with `{ paused, house }`. This
 * reads the second shape and answers null for the first, so a screen can fall
 * back to what it already knew rather than printing "undefined".
 */
export function pausedHouseName(payload: PausedPayload): string | null {
  return payload.house?.name ?? null;
}
