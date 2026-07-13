import { toast } from "sonner";

import { apiErrorMessage } from "./errors";

// The client-side end of the error contract. A server client throws an `ApiError`
// (or a server action returns its `.toBody()`); a Client Component catches it and
// calls this to show the one line that matters. The message logic lives in
// `apiErrorMessage` (framework-neutral, so it works server-side too); this only
// adds the sonner toast side-effect, so it belongs to the client.

/**
 * Show an error as a toast and return the message shown (handy for also setting an
 * inline field error). Pass a `fallback` for the context an unexpected error can't
 * describe itself — e.g. `toastApiError(err, "Couldn't save the member.")`.
 */
export function toastApiError(error: unknown, fallback?: string): string {
  const message = apiErrorMessage(error, fallback);
  toast.error(message);
  return message;
}
