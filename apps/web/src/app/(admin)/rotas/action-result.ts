import type { ApiErrorBody } from "@/lib/api/errors";

/**
 * What a rota server action returns to the client. The admin API client is
 * `server-only`, so every mutation the editor makes goes through an action; this
 * is the wire shape across that boundary.
 *
 * On failure we return `error` — the plain, serializable `ApiErrorBody` (see
 * `ApiError#toBody`) — rather than throwing, so the client can switch on
 * `error.error` (e.g. `confirmation_required`, `validation_failed`) and read the
 * extras that ride along (`warning`, `fields`) to drive the confirm dialog and
 * inline messages. A thrown error can't carry that structure across an action.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };
