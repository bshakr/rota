import { describe, expect, it } from "vitest";

import { explainError, kindDisplay, reminderTiming, statusDisplay } from "./display";

describe("statusDisplay", () => {
  it("maps each carrier status to a label and a Badge tone", () => {
    expect(statusDisplay("delivered")).toEqual({ label: "Delivered", tone: "success" });
    expect(statusDisplay("sent")).toEqual({ label: "Sent", tone: "info" });
    expect(statusDisplay("pending")).toEqual({ label: "Queued", tone: "info" });
    expect(statusDisplay("sending")).toEqual({ label: "Sending", tone: "warning" });
    expect(statusDisplay("failed")).toEqual({ label: "Failed", tone: "destructive" });
  });

  it("falls back to the raw value on a status it does not know", () => {
    // SmsStatus is a bare string on purpose — a new carrier state must still render.
    expect(statusDisplay("undelivered")).toEqual({ label: "undelivered", tone: "secondary" });
  });
});

describe("kindDisplay", () => {
  it("names the two kinds in human words", () => {
    expect(kindDisplay("reminder")).toBe("Reminder");
    expect(kindDisplay("cover_notice")).toBe("Cover notice");
  });
});

describe("reminderTiming", () => {
  it("reads an offset as when the text was meant to land", () => {
    expect(reminderTiming(0)).toBe("on the day");
    expect(reminderTiming(1)).toBe("1 day before");
    expect(reminderTiming(3)).toBe("3 days before");
  });

  it("is null for a cover notice, which carries no offset", () => {
    expect(reminderTiming(null)).toBeNull();
  });
});

describe("explainError", () => {
  it("translates the three send-side sentinels into plain sentences", () => {
    expect(explainError("not_contactable").summary).toMatch(/inactive|opted out/i);
    expect(explainError("not_contactable").detail).toBe("Send-side error");
    expect(explainError("invalid_template").summary).toMatch(/template/i);
    expect(explainError("internal_error").summary).toMatch(/our side|unexpected/i);
  });

  it("translates the common Twilio codes, keeping the raw code as the quiet detail", () => {
    const stop = explainError("21610");
    expect(stop.summary).toMatch(/unsubscribed|STOP/i);
    expect(stop.detail).toBe("Carrier code 21610");

    expect(explainError("30006").summary).toMatch(/landline|carrier/i);
  });

  it("shows an unknown code with a neutral label rather than pretending to know it", () => {
    const unknown = explainError("99999");
    expect(unknown.summary).toMatch(/carrier reported an error/i);
    expect(unknown.detail).toBe("Carrier code 99999");
  });

  it("handles a failed row that carries no code at all", () => {
    const none = explainError(null);
    expect(none.summary).toMatch(/undelivered|no reason/i);
    expect(none.detail).toBeNull();
  });
});
