"use server";

import { revalidatePath } from "next/cache";

import {
  createRota,
  deleteRota,
  previewRotaMessage,
  updateRota,
  updateRotaPositions,
} from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import type {
  RotaPositionsResponse,
  RotaPreviewParams,
  RotaPreviewResponse,
  RotaResponse,
  RotaWriteParams,
} from "@/lib/api/types";

import type { ActionResult } from "./action-result";

// The rota editor's writes and its live preview all cross into the server-only
// admin client through these actions. Each one turns an ApiError into a plain
// result the client can branch on (the schedule-change `confirmation_required`,
// the unknown-placeholder `validation_failed`), and re-throws anything else — a
// 401 inside the client calls `redirect()`, whose control-flow error must reach
// Next untouched, never be swallowed as a failed result.

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (isApiError(error)) {
      return { ok: false, error: error.toBody() };
    }
    throw error;
  }
}

export async function createRotaAction(
  params: RotaWriteParams,
): Promise<ActionResult<RotaResponse>> {
  const result = await run(() => createRota(params));
  if (result.ok) revalidatePath("/rotas");
  return result;
}

/**
 * A schedule change (`starts_on` / `interval_*`) without `confirm` answers with a
 * `confirmation_required` error carrying the `warning` of what it would drop and
 * changes nothing; the client shows the destructive confirm, then calls again
 * with `confirm: true`. A change that touches no schedule field just succeeds.
 */
export async function updateRotaAction(
  id: number,
  params: RotaWriteParams,
  confirm?: boolean,
): Promise<ActionResult<RotaResponse>> {
  const result = await run(() => updateRota(id, params, confirm ? { confirm: true } : undefined));
  if (result.ok) {
    revalidatePath("/rotas");
    revalidatePath(`/rotas/${id}`);
  }
  return result;
}

/** The roster IS the rotation. Replacing it regenerates future shifts but preserves covers — no warning. */
export async function updateRotaPositionsAction(
  id: number,
  memberIds: number[],
): Promise<ActionResult<RotaPositionsResponse>> {
  const result = await run(() => updateRotaPositions(id, memberIds));
  if (result.ok) {
    revalidatePath("/rotas");
    revalidatePath(`/rotas/${id}`);
  }
  return result;
}

/** Read-only: render the in-progress template through the real sender for the live preview. */
export async function previewMessageAction(
  id: number,
  params: RotaPreviewParams,
): Promise<ActionResult<RotaPreviewResponse>> {
  return run(() => previewRotaMessage(id, params));
}

/** Retire a rota (soft deactivate). History stands; the reminder sweep stops visiting it. */
export async function deactivateRotaAction(id: number): Promise<ActionResult<RotaResponse>> {
  const result = await run(() => deleteRota(id));
  if (result.ok) revalidatePath("/rotas");
  return result;
}
