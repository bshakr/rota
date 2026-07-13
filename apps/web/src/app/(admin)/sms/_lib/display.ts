// The words the SMS log puts on screen. Kept out of the components — and unit
// tested — because "explain the carrier error in human terms" is the whole point
// of this screen, and a mistranslated code is worse than a bare one.

import type { SmsKind, SmsStatus } from "@/lib/api/types";

/**
 * Which Badge variant carries a status. These are the status tones the design
 * system defines (see /styleguide) — no new colour is invented here. `sending` is
 * the in-flight waypoint, `pending` the claimed-but-unsent row; both read as
 * "not done yet" rather than success or failure.
 */
export type StatusTone = "success" | "warning" | "info" | "destructive" | "secondary";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Sent", tone: "info" },
  pending: { label: "Queued", tone: "info" },
  sending: { label: "Sending", tone: "warning" },
  failed: { label: "Failed", tone: "destructive" },
};

/**
 * A status to its badge. `SmsStatus` is a bare string on purpose (a new carrier
 * state must never make a valid row fail to render), so an unknown value falls
 * back to a neutral badge showing the raw text rather than throwing.
 */
export function statusDisplay(status: SmsStatus): { label: string; tone: StatusTone } {
  return STATUS[status] ?? { label: status, tone: "secondary" };
}

/** The two kinds of message this house sends, in human words. */
export function kindDisplay(kind: SmsKind): string {
  return kind === "cover_notice" ? "Cover notice" : "Reminder";
}

/**
 * A reminder is identified by how many days before the shift it was meant to
 * land. 0 is "on the day". `null` only ever appears on a cover notice (which
 * carries no offset), so this returns null and the caller shows nothing.
 */
export function reminderTiming(daysBefore: number | null): string | null {
  if (daysBefore === null) return null;
  if (daysBefore === 0) return "on the day";
  if (daysBefore === 1) return "1 day before";
  return `${daysBefore} days before`;
}

export interface ErrorExplanation {
  /** A plain sentence an admin can act on. */
  summary: string;
  /** The raw signal shown quietly beside the sentence, or null when there is nothing more to add. */
  detail: string | null;
}

// Our own send-side failures. These share the error_code column with Twilio's
// numeric codes but are word-shaped, so they can never collide (see
// SmsMessage in apps/api). The stored values are lowercase.
const SENTINELS: Record<string, string> = {
  not_contactable:
    "The member was inactive or had opted out when the reminder ran, so nothing was sent.",
  invalid_template:
    "The rota's message template had an unknown placeholder or a stray brace, so the text could not be built.",
  internal_error:
    "Something failed unexpectedly on our side while sending — not the carrier. It is worth retrying.",
};

// The Twilio SMS error codes worth translating. Anything not here falls back to a
// neutral label with the code still shown, so an unmapped code degrades to "we
// don't have a plain explanation" rather than a wrong one.
const CARRIER: Record<string, string> = {
  "21610":
    "The recipient has unsubscribed by replying STOP. They must text START before we can message them again.",
  "21211": "The phone number is not a valid destination — check the number on the member.",
  "21614": "That number cannot receive SMS — it is not a valid mobile number.",
  "21408": "Texting this number's region is not enabled on the Twilio account.",
  "30003": "The handset was unreachable — switched off, or out of coverage.",
  "30004": "The message was blocked, usually because the recipient blocked the sender.",
  "30005": "The number is unknown or no longer active.",
  "30006": "That number is a landline, or its carrier cannot receive texts.",
  "30007": "The carrier flagged the message as spam and filtered it.",
  "30008": "Delivery failed at the carrier for an unspecified reason.",
};

/**
 * Turn an error_code into something an admin can read. Sentinels and known
 * carrier codes get a real sentence; an unknown code gets a neutral one with the
 * code preserved; a failed row with no code at all says exactly that.
 */
export function explainError(code: string | null): ErrorExplanation {
  if (code === null || code === "") {
    return {
      summary: "The carrier reported the message as undelivered but gave no reason code.",
      detail: null,
    };
  }

  const sentinel = SENTINELS[code];
  if (sentinel) return { summary: sentinel, detail: "Send-side error" };

  const carrier = CARRIER[code];
  if (carrier) return { summary: carrier, detail: `Carrier code ${code}` };

  return {
    summary: "The carrier reported an error delivering this message.",
    detail: `Carrier code ${code}`,
  };
}
