"use server";

import { revalidatePath } from "next/cache";

import { connectCalendar, disconnectCalendar, syncCalendar, updateGroup } from "@/lib/api/admin";
import { type ApiErrorBody, isApiError } from "@/lib/api/errors";
import type { CalendarEventPreviewItem, CalendarSummary, Group } from "@/lib/api/types";

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

export type CalendarActionResult<T> = ({ ok: true } & T) | { ok: false; error: ApiErrorBody };

// The house calendar link (BLO-1667). The link is a credential: it travels from the form to Rails
// through this server action and is never echoed back. The API answers with a masked form only.
export async function connectHouseCalendar(
  icalUrl: string,
): Promise<CalendarActionResult<{ calendar: CalendarSummary; events: CalendarEventPreviewItem[] }>> {
  try {
    const { calendar, events_preview } = await connectCalendar(icalUrl);
    revalidatePath("/dashboard");
    return { ok: true, calendar, events: events_preview };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

export async function syncHouseCalendar(): Promise<CalendarActionResult<{ calendar: CalendarSummary }>> {
  try {
    const { calendar } = await syncCalendar();
    revalidatePath("/dashboard");
    return { ok: true, calendar };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}

export async function disconnectHouseCalendar(): Promise<CalendarActionResult<Record<never, never>>> {
  try {
    await disconnectCalendar();
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error: error.toBody() };
    throw error;
  }
}
