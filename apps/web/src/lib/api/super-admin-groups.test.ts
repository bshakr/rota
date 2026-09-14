import { describe, expect, it } from "vitest";

import {
  emptySmsLogPayload,
  groupPayload,
  groupSmsLogPayload,
  quietGroupPayload,
} from "@/test/group-payload";
import { UPCOMING_DAYS } from "@/lib/hq-group-report";

import { groupDetailSchema, groupSmsMessagesSchema } from "./super-admin-groups";

// The key lists, copied BY HAND from the Rails source that emits them:
//
//   apps/api/app/queries/super_admin/group_report.rb
//     UPCOMING_DAYS = 14
//     WEEKS         = 12
//     call          → warnings_input, upcoming_shifts, weekly, admins, members, spend
//     upcoming_shift→ id, rota_id, rota_name, rota_active, rota_draft, due_on, covered,
//                     assigned_member, covering_member, responsible_member
//     weekly        → week_start, texts, covers
//     admins        → AdminSerializer + last_seen_at, user_sign_in_count, user_sign_in_count_30d
//     members       → MemberSerializer + last_seen_at
//
//   apps/api/app/serializers/super_admin/admin_serializer.rb
//     as_json       → id, user_id, name, email, workos_user_id, role
//     name          → NULLABLE (`users.name` has no NOT NULL; an AuthKit token carries no
//                     `name` claim unless the WorkOS JWT template adds one)
//     email         → NULLABLE (null where the stored address is the JIT .invalid placeholder)
//   `members.name`, by contrast, IS NOT NULL — a housemate is typed in by an admin.
//
//   apps/api/app/queries/super_admin/warnings_input.rb
//     call          → group, rotas, members, failed_sms
//     (::GroupSerializer, ::RotaSerializer, ::MemberSerializer minus access_token,
//      SuperAdmin::SmsMessageSerializer)
//
//   apps/api/app/serializers/super_admin/sms_message_serializer.rb
//     as_json       → id, kind, status, error_code, days_before, body, twilio_sid,
//                     sent_at, created_at, member, shift
//
//   apps/api/app/controllers/super_admin/groups_controller.rb#show
//     renders       → group, admins, members, rotas, recent_sms_messages, report
//
// Hardcoded rather than read off disk, exactly as super-admin-traffic.test.ts does
// it. The point is not to re-derive the lists — it is that nobody can widen,
// narrow or rename one without editing this copy of the Ruby beside it, which
// means opening the Ruby.
const RUBY_REPORT_KEYS = [
  "warnings_input",
  "upcoming_shifts",
  "weekly",
  "admins",
  "members",
  "spend",
];
const RUBY_WARNINGS_INPUT_KEYS = ["group", "rotas", "members", "failed_sms"];
const RUBY_UPCOMING_SHIFT_KEYS = [
  "id",
  "rota_id",
  "rota_name",
  "rota_active",
  "rota_draft",
  "due_on",
  "covered",
  "assigned_member",
  "covering_member",
  "responsible_member",
];
const RUBY_WEEKLY_KEYS = ["week_start", "texts", "covers"];
const RUBY_SMS_KEYS = [
  "id",
  "kind",
  "status",
  "error_code",
  "days_before",
  "body",
  "twilio_sid",
  "sent_at",
  "created_at",
  "member",
  "shift",
];
const RUBY_UPCOMING_DAYS = 14;
const RUBY_WEEKS = 12;

function parsed(payload: unknown = groupPayload()) {
  const result = groupDetailSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return result.data;
}

/** The payload with one key removed from `report`, the drift this parse exists to catch. */
function reportWithout(key: string) {
  const body = groupPayload() as { report: Record<string, unknown> };
  const report = { ...body.report };
  delete report[key];
  return { ...body, report };
}

describe("the group report's key lists", () => {
  it("carries every section SuperAdmin::GroupReport renders, and no more", () => {
    expect(Object.keys(parsed().report).sort()).toEqual([...RUBY_REPORT_KEYS].sort());
  });

  it("carries the four payloads SuperAdmin::WarningsInput composes", () => {
    expect(Object.keys(parsed().report.warnings_input).sort()).toEqual(
      [...RUBY_WARNINGS_INPUT_KEYS].sort(),
    );
  });

  it("names every field an upcoming turn arrives with", () => {
    const shift = parsed().report.upcoming_shifts[0];
    expect(Object.keys(shift).sort()).toEqual([...RUBY_UPCOMING_SHIFT_KEYS].sort());
  });

  it("names the three figures in a weekly bucket", () => {
    expect(Object.keys(parsed().report.weekly[0]).sort()).toEqual([...RUBY_WEEKLY_KEYS].sort());
  });

  it("names every field a redacted log row arrives with", () => {
    const rows = groupSmsMessagesSchema.parse(groupSmsLogPayload()).sms_messages;
    expect(Object.keys(rows[0]).sort()).toEqual([...RUBY_SMS_KEYS].sort());
  });

  // The web app states the window in words ("Nothing is due in the next 14
  // days"), which is only honest while it matches what Rails actually looked at.
  it("looks ahead exactly as far as GroupReport::UPCOMING_DAYS", () => {
    expect(UPCOMING_DAYS).toBe(RUBY_UPCOMING_DAYS);
  });

  it("draws the twelve weeks GroupReport::WEEKS produces", () => {
    expect(parsed().report.weekly).toHaveLength(RUBY_WEEKS);
  });
});

describe("groupDetailSchema", () => {
  it("reads a well-formed house back with its figures intact", () => {
    const detail = parsed();

    expect(detail.group.name).toBe("Alma Terrace");
    expect(detail.rotas).toHaveLength(3);
    expect(detail.report.admins[0].user_sign_in_count_30d).toBe(9);
    expect(detail.report.members[0].last_seen_at).toBe("2026-09-13T20:15:00.000Z");
    expect(detail.report.weekly.at(-1)).toEqual({
      week_start: "2026-09-14",
      texts: 7,
      covers: 1,
    });
    expect(detail.report.spend).toBeNull();
  });

  // The production bug this schema had: `users.name` carries no NOT NULL and an
  // AuthKit token has no `name` claim unless the WorkOS JWT template adds one, so
  // Rails serves null — and a non-null `z.string()` turned one such row into a
  // shape error that blanked the entire house page.
  // https://linear.app/bloombase/issue/BLO-1694
  it("reads an admin WorkOS never named", () => {
    const admins = parsed().report.admins;

    expect(admins.map((admin) => admin.name)).toEqual([
      "Priya Raman",
      "Dan Okoro",
      null,
      null,
    ]);
  });

  it.each([
    ["an admin with no name but an address", { name: null, email: "rosa@example.com" }],
    ["an admin with neither", { name: null, email: null }],
  ])("parses a report carrying %s", (_what, overrides) => {
    const body = groupPayload() as { report: { admins: Record<string, unknown>[] } };
    const only = {
      ...body,
      report: { ...body.report, admins: [{ ...body.report.admins[0], ...overrides }] },
    };

    const result = groupDetailSchema.safeParse(only);
    expect(result.success).toBe(true);
    expect(result.data?.report.admins[0]).toMatchObject(overrides);
  });

  // Nullable, not "anything". A number where a name should be is still drift.
  it("still refuses a name that is neither a string nor null", () => {
    const body = groupPayload() as { report: { admins: Record<string, unknown>[] } };
    const broken = {
      ...body,
      report: { ...body.report, admins: [{ ...body.report.admins[0], name: 42 }] },
    };

    const result = groupDetailSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path.join(".")).toBe("report.admins.0.name");
  });

  it("reads a house nothing has happened on yet", () => {
    const detail = parsed(quietGroupPayload());

    expect(detail.rotas).toEqual([]);
    expect(detail.report.upcoming_shifts).toEqual([]);
    expect(detail.report.members).toEqual([]);
    expect(detail.report.warnings_input.group.calendar).toBeNull();
    // Zero-filled rather than short: a flat line, not a stub of one.
    expect(detail.report.weekly).toHaveLength(RUBY_WEEKS);
  });

  // `admins` and `members` used to arrive twice — once plain at the top level and
  // once on the report with the columns only the report can know. The page now
  // reads the report's, so the duplicates are gone from this schema; Rails still
  // sends them and zod still strips them, which is the point of the assertion.
  it("no longer models the duplicated top-level admins and members", () => {
    const detail = parsed() as Record<string, unknown>;

    expect(detail).not.toHaveProperty("admins");
    expect(detail).not.toHaveProperty("members");
  });

  // `recent_sms_messages` rides on the real payload and is deliberately unmodelled:
  // the page draws its log from the filtered endpoint instead.
  it("strips the keys it does not read rather than refusing the payload", () => {
    expect(parsed()).not.toHaveProperty("recent_sms_messages");
  });

  it.each(RUBY_REPORT_KEYS)("refuses a payload whose report has lost %s", (key) => {
    const result = groupDetailSchema.safeParse(reportWithout(key));

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.includes(key))).toBe(true);
  });

  // The tolerant one, and the only one. `spend` is null today and BLO-1684 fills
  // it in; this page does not draw it, so a shape landing on the API first must
  // not blank a console that never looks at it. A MISSING key still fails, above.
  it("accepts a spend object it does not yet read", () => {
    const body = groupPayload() as { report: Record<string, unknown> };
    const withSpend = {
      ...body,
      report: { ...body.report, spend: { texts_usd: "1.42", claude_usd: "0.08" } },
    };

    expect(groupDetailSchema.safeParse(withSpend).success).toBe(true);
  });

  it("names the field that disagreed rather than failing anonymously", () => {
    const body = groupPayload() as { report: { weekly: unknown[] } };
    const broken = {
      ...body,
      report: { ...body.report, weekly: [{ week_start: "2026-09-14", texts: "seven", covers: 1 }] },
    };

    const result = groupDetailSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path.join(".")).toBe("report.weekly.0.texts");
  });
});

describe("groupSmsMessagesSchema", () => {
  it("reads a log whose bodies are already redacted", () => {
    const rows = groupSmsMessagesSchema.parse(groupSmsLogPayload()).sms_messages;

    expect(rows).toHaveLength(5);
    expect(rows[0].body).toContain("[link]");
    // A fixture guard, not a proof: this only says the fixture carries no
    // magic link, so the page is never written against one. The real redaction
    // guarantee is apps/api/spec/requests/super_admin/redaction_spec.rb, where
    // the serializer is exercised over real rows.
    expect(JSON.stringify(rows)).not.toMatch(/\/s\/\w/);
  });

  // A row Rails has not sent yet has no body at all. Null, never "": an empty
  // string would render as a blank bubble and read as "we sent a blank text".
  it("accepts a row that was never sent, whose body is null", () => {
    const rows = groupSmsMessagesSchema.parse(groupSmsLogPayload()).sms_messages;
    const unsent = rows.find((row) => row.status === "pending");

    expect(unsent?.body).toBeNull();
  });

  it("reads an empty log", () => {
    expect(groupSmsMessagesSchema.parse(emptySmsLogPayload()).sms_messages).toEqual([]);
  });

  // `status` is a bare string on purpose: a carrier state Rails learns to write
  // must render rather than blank the operator's console.
  it("accepts a delivery status it has never heard of", () => {
    const body = groupSmsLogPayload() as { sms_messages: Record<string, unknown>[] };
    const exotic = {
      sms_messages: [{ ...body.sms_messages[0], status: "undelivered_by_carrier" }],
    };

    expect(groupSmsMessagesSchema.parse(exotic).sms_messages[0].status).toBe(
      "undelivered_by_carrier",
    );
  });
});
