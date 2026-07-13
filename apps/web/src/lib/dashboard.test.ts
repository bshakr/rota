import { describe, expect, it } from "vitest";

import { collectDashboardWarnings } from "./dashboard";
import type { Group, Member, Rota, SmsMessage } from "./api/types";

// The dashboard's warning surface is the point of the screen: a silently failed
// text, a rota that quietly sends nothing, a timezone nobody confirmed. These
// tests pin WHICH conditions raise a warning, in what order, and that the copy
// counts and names correctly — the rendering (Alert variants) is a thin wrapper.

const SETTINGS_HREF = "/rotas/settings";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: "Flat 3",
    timezone: "Europe/London",
    timezone_confirmed: true,
    timezone_confirmed_at: "2026-07-01T09:00:00Z",
    ...overrides,
  };
}

function rota(overrides: Partial<Rota> = {}): Rota {
  return {
    id: 1,
    name: "Bins",
    message_template: "Your turn: {{rota}}",
    starts_on: "2026-07-01",
    interval_count: 1,
    interval_unit: "week",
    send_hour: 9,
    reminder_offsets: [0],
    active: true,
    draft: false,
    positions: [{ member_id: 1, name: "Alice", position: 0 }],
    ...overrides,
  };
}

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 1,
    name: "Alice",
    phone_e164: "+447700900001",
    active: true,
    contactable: true,
    sms_opted_out_at: null,
    access_token: "tok",
    ...overrides,
  };
}

function failedSms(overrides: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 1,
    kind: "reminder",
    status: "failed",
    error_code: "30006",
    days_before: 0,
    body: "Your turn",
    twilio_sid: "SM1",
    sent_at: null,
    created_at: "2026-07-13T09:00:00Z",
    member: { id: 1, name: "Alice" },
    shift: { id: 10, rota_id: 1, rota_name: "Bins", due_on: "2026-07-13" },
    ...overrides,
  };
}

function base() {
  return {
    group: group(),
    rotas: [rota()],
    members: [member()],
    failedSms: [] as SmsMessage[],
    settingsHref: SETTINGS_HREF,
  };
}

describe("collectDashboardWarnings", () => {
  it("returns nothing when the house is healthy", () => {
    expect(collectDashboardWarnings(base())).toEqual([]);
  });

  it("warns about an unconfirmed timezone and links to settings", () => {
    const warnings = collectDashboardWarnings({
      ...base(),
      group: group({ timezone_confirmed: false, timezone_confirmed_at: null }),
    });
    const tz = warnings.find((w) => w.id === "timezone");
    expect(tz).toBeDefined();
    expect(tz?.severity).toBe("warning");
    expect(tz?.href).toBe(SETTINGS_HREF);
    expect(tz?.description).toContain("Europe/London");
  });

  it("shouts (destructive) about failed texts and names who missed one", () => {
    const warnings = collectDashboardWarnings({
      ...base(),
      failedSms: [
        failedSms({ id: 1, member: { id: 1, name: "Alice" } }),
        failedSms({ id: 2, member: { id: 2, name: "Bob" } }),
      ],
    });
    const fail = warnings.find((w) => w.id === "failed-sms");
    expect(fail?.severity).toBe("destructive");
    expect(fail?.title).toContain("2");
    expect(fail?.description).toContain("Alice");
    expect(fail?.description).toContain("Bob");
    expect(fail?.href).toBe("/sms");
  });

  it("counts each person once even with several failed texts", () => {
    const warnings = collectDashboardWarnings({
      ...base(),
      failedSms: [
        failedSms({ id: 1, member: { id: 1, name: "Alice" } }),
        failedSms({ id: 2, member: { id: 1, name: "Alice" } }),
      ],
    });
    const fail = warnings.find((w) => w.id === "failed-sms");
    // Two failed rows, one person — the headline is about people, not rows.
    expect(fail?.title).toContain("1");
    expect(fail?.description.match(/Alice/g)).toHaveLength(1);
  });

  it("warns about draft rotas and names them", () => {
    const warnings = collectDashboardWarnings({
      ...base(),
      rotas: [rota({ id: 1, name: "Bins", draft: false }), rota({ id: 2, name: "Recycling", draft: true, positions: [] })],
    });
    const draft = warnings.find((w) => w.id === "draft-rotas");
    expect(draft?.severity).toBe("warning");
    expect(draft?.description).toContain("Recycling");
    expect(draft?.description).not.toContain("Bins");
    expect(draft?.href).toBe("/rotas");
  });

  it("warns only about ACTIVE members who can't be texted", () => {
    const warnings = collectDashboardWarnings({
      ...base(),
      members: [
        member({ id: 1, name: "Alice", contactable: true }),
        member({ id: 2, name: "Bob", active: true, contactable: false, sms_opted_out_at: "2026-07-01T00:00:00Z" }),
        member({ id: 3, name: "Cara", active: false, contactable: false }), // deactivated — not a surprise
      ],
    });
    const bad = warnings.find((w) => w.id === "uncontactable");
    expect(bad).toBeDefined();
    expect(bad?.description).toContain("Bob");
    expect(bad?.description).not.toContain("Alice");
    expect(bad?.description).not.toContain("Cara");
    expect(bad?.href).toBe("/members");
  });

  it("orders warnings by how load-bearing they are: timezone, failed sms, drafts, people", () => {
    const warnings = collectDashboardWarnings({
      group: group({ timezone_confirmed: false, timezone_confirmed_at: null }),
      rotas: [rota({ id: 2, name: "Recycling", draft: true, positions: [] })],
      members: [member({ id: 2, name: "Bob", contactable: false, sms_opted_out_at: "2026-07-01T00:00:00Z" })],
      failedSms: [failedSms()],
      settingsHref: SETTINGS_HREF,
    });
    expect(warnings.map((w) => w.id)).toEqual([
      "timezone",
      "failed-sms",
      "draft-rotas",
      "uncontactable",
    ]);
  });

  it("uses singular copy for a single item", () => {
    const warnings = collectDashboardWarnings({
      ...base(),
      rotas: [rota({ id: 2, name: "Recycling", draft: true, positions: [] })],
    });
    const draft = warnings.find((w) => w.id === "draft-rotas");
    expect(draft?.title).toBe("1 rota in draft");
  });
});
