"use server";

import { requestHouseholdLink, validHouseholdSlug } from "@/lib/api/household-entry";

export interface EntryState { message: string; error?: boolean }

export async function sendEntryLink(slug: string, _previous: EntryState, formData: FormData): Promise<EntryState> {
  const phone = formData.get("phone");
  if (!validHouseholdSlug(slug) || typeof phone !== "string" || !phone.trim() || phone.length > 40) {
    return { message: "Enter your phone number, including its country code.", error: true };
  }
  // Deliberately public. Rails verifies household membership, contactability and
  // persisted send limits; neither client fields nor a WorkOS session grant access.
  try {
    await requestHouseholdLink(slug, phone);
  } catch {
    return { message: "We couldn’t process your request. Please try again shortly.", error: true };
  }
  return { message: "If that number is registered with this household and can receive texts, we’ll send your personal link. Allow a few minutes; repeated requests are limited." };
}
