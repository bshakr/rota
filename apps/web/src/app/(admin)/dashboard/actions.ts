"use server";

import { revalidatePath } from "next/cache";

import { updateGroup } from "@/lib/api/admin";
import { type ApiErrorBody, isApiError } from "@/lib/api/errors";
import type { Group } from "@/lib/api/types";

// Group settings (name + timezone) as a server action. The admin API client is
// `server-only`, so the dashboard's settings form reaches `updateGroup` through
// here. Sending `timezone` at all is the human confirming it — Rails stamps
// `timezone_confirmed_at` and the unconfirmed-timezone warning clears.

export type SaveGroupResult =
  | { ok: true; group: Group }
  | { ok: false; error: ApiErrorBody };

export async function saveGroupSettings(params: {
  name: string;
  timezone: string;
}): Promise<SaveGroupResult> {
  try {
    const { group } = await updateGroup(params);
    // The warning surface is server-rendered off getGroup(); revalidate so
    // confirming the timezone drops the warning without a manual reload.
    revalidatePath("/dashboard");
    return { ok: true, group };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}
