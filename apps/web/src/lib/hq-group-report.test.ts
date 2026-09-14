import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { UpcomingShift, WeeklyWeek } from "./api/super-admin-groups";
import { type DashboardWarning, collectDashboardWarnings } from "./dashboard";
import {
  GROUP_SECTION,
  NO_SMS_LOG_FILTERS,
  OPERATOR_SETTINGS_HREF,
  OPERATOR_WARNING_TARGETS,
  SMS_LOG_MAX_LIMIT,
  SMS_LOG_PAGE,
  type SmsLogFilters,
  groupLogHref,
  hasSmsLogFilters,
  nextSmsLogLimit,
  operatorWarning,
  parseSmsLogFilters,
  smsLogCountNote,
  smsLogSearchParams,
  turnHolder,
  turnIsSilent,
  turnRotaState,
  turnSilenceNote,
  upcomingDays,
  upcomingWindowNote,
  usagePoints,
  usageTotal,
} from "./hq-group-report";

// --- Warnings ---------------------------------------------------------------

// Copied by hand from `collectDashboardWarnings` in src/lib/dashboard.ts, in the
// order it pushes them. Hardcoded on purpose: the point is that a sixth warning
// cannot be added without editing this line, which means opening the file — and
// the reason that matters is that a warning with no entry in
// OPERATOR_WARNING_TARGETS would otherwise keep a HOUSE route on the operator's
// screen, sending them to their own house's rotas.
const COLLECTOR_WARNING_IDS = [
  "timezone",
  "calendar-sync",
  "failed-sms",
  "draft-rotas",
  "uncontactable",
];

/** A house that trips every warning at once, in the collector's own input shape. */
function everyWarning(): DashboardWarning[] {
  return collectDashboardWarnings({
    group: {
      id: 1,
      name: "Alma Terrace",
      slug: "alma-terrace",
      timezone: "UTC",
      timezone_confirmed: false,
      timezone_confirmed_at: null,
      calendar: {
        calendar_name: "House",
        masked_url: "https://example.test/…/basic.ics",
        events_count: 3,
        unclassified_count: 0,
        last_synced_at: null,
        last_error: "The calendar link returned 404.",
        failing: true,
      },
    },
    rotas: [
      {
        id: 1,
        name: "Recycling",
        message_template: "{{name}}",
        starts_on: "2026-09-07",
        interval_count: 1,
        interval_unit: "week",
        send_hour: 9,
        reminder_offsets: [0],
        active: true,
        draft: true,
        positions: [],
      },
    ],
    members: [{ name: "Dan", active: true, contactable: false }],
    failedSms: [{ member: { id: 2, name: "Dan" } }],
    settingsHref: OPERATOR_SETTINGS_HREF,
  });
}

describe("the operator's warning destinations", () => {
  it("has one for every warning the collector can raise", () => {
    expect(Object.keys(OPERATOR_WARNING_TARGETS).sort()).toEqual(
      [...COLLECTOR_WARNING_IDS].sort(),
    );
  });

  it("raises all five off a house in trouble", () => {
    expect(everyWarning().map((warning) => warning.id)).toEqual(COLLECTOR_WARNING_IDS);
  });

  // The guarantee the plan asks for: the operator sees EXACTLY the alerts the
  // admin sees. Only where "fix it" goes may differ.
  it("leaves the words, the order and the severity of every alert alone", () => {
    const before = everyWarning();
    const after = before.map(operatorWarning);

    expect(after.map((w) => [w.id, w.title, w.description, w.severity])).toEqual(
      before.map((w) => [w.id, w.title, w.description, w.severity]),
    );
  });

  // The whole reason this function exists: `/sms`, `/rotas` and `/members` are
  // house-admin routes, and an operator clicking one would open THEIR OWN house.
  it("sends no warning to a house-admin route", () => {
    for (const warning of everyWarning().map(operatorWarning)) {
      expect(warning.href.startsWith("#")).toBe(true);
    }
  });

  it("aims each warning at the section of this page that answers it", () => {
    const byId = Object.fromEntries(
      everyWarning().map(operatorWarning).map((warning) => [warning.id, warning.href]),
    );

    expect(byId["failed-sms"]).toBe(`#${GROUP_SECTION.smsLog}`);
    expect(byId["draft-rotas"]).toBe(`#${GROUP_SECTION.rotas}`);
    expect(byId.uncontactable).toBe(`#${GROUP_SECTION.members}`);
    expect(byId.timezone).toBe(`#${GROUP_SECTION.header}`);
    // Nothing on this console can re-enter somebody's iCal URL, so the honest
    // destination is the people who can.
    expect(byId["calendar-sync"]).toBe(`#${GROUP_SECTION.admins}`);
  });

  // The one thing the assertions above cannot catch. They compare two strings
  // that are built from the same constant, so they agree with each other whether
  // or not anything on the page ever renders the anchor — and a `#house-admins`
  // that no element carries scrolls nowhere at all, silently. So the components
  // are read off disk and every destination has to be found in one of them.
  it("aims every warning at an anchor a component actually renders", () => {
    const dir = fileURLToPath(
      new URL("../app/(super-admin)/super-admin/groups/[id]/_components/", import.meta.url),
    );
    const components = readdirSync(dir).filter((name) => name.endsWith(".tsx"));
    const sources = components.map((name) => readFileSync(join(dir, name), "utf8")).join("\n");

    // If the folder ever moves, fail here rather than passing on an empty read.
    expect(components.length).toBeGreaterThan(0);

    const keyOf = new Map<string, string>(
      Object.entries(GROUP_SECTION).map(([key, anchor]) => [anchor, key]),
    );
    const destinations = [
      OPERATOR_SETTINGS_HREF,
      ...Object.values(OPERATOR_WARNING_TARGETS).map((target) => target.href),
    ];

    for (const href of destinations) {
      const key = keyOf.get(href.replace(/^#/, ""));

      // Hand-typed anchors are how the two halves drift apart; every
      // destination has to be a GROUP_SECTION value.
      expect(key, `${href} is not a GROUP_SECTION value`).toBeDefined();
      expect(sources, `${href} is rendered by no component in ${dir}`).toContain(
        `id={GROUP_SECTION.${key}}`,
      );
    }
  });

  it("points an unknown warning at the top of the house rather than off it", () => {
    const invented: DashboardWarning = {
      id: "something-new",
      severity: "warning",
      title: "A warning this map has not heard of",
      description: "…",
      href: "/rotas",
      action: "Open rotas",
    };

    expect(operatorWarning(invented).href).toBe(`#${GROUP_SECTION.header}`);
  });
});

// --- The fortnight ----------------------------------------------------------

function shift(overrides: Partial<UpcomingShift> & Pick<UpcomingShift, "id" | "due_on">) {
  return {
    rota_id: 41,
    rota_name: "Bins",
    rota_active: true,
    rota_draft: false,
    covered: false,
    assigned_member: { id: 101, name: "Priya" },
    covering_member: null,
    responsible_member: { id: 101, name: "Priya" },
    ...overrides,
  } as UpcomingShift;
}

describe("upcomingDays", () => {
  const today = "2026-09-14";

  it("groups turns into the days they fall on, keeping Rails' order", () => {
    const days = upcomingDays(
      [
        shift({ id: 1, due_on: "2026-09-14" }),
        shift({ id: 2, due_on: "2026-09-14", rota_name: "Hallway" }),
        shift({ id: 3, due_on: "2026-09-16" }),
      ],
      today,
    );

    expect(days.map((day) => day.due_on)).toEqual(["2026-09-14", "2026-09-16"]);
    expect(days[0].shifts.map((s) => s.id)).toEqual([1, 2]);
  });

  it("names today and tomorrow, and lets every other day be its date", () => {
    const days = upcomingDays(
      [
        shift({ id: 1, due_on: "2026-09-14" }),
        shift({ id: 2, due_on: "2026-09-15" }),
        shift({ id: 3, due_on: "2026-09-21" }),
      ],
      today,
    );

    expect(days.map((day) => day.soon)).toEqual(["Today", "Tomorrow", null]);
    // The date is always there, relative word or not: a screenshot with only
    // "Today" on it cannot be dated afterwards.
    expect(days.map((day) => day.date)).toEqual(["Mon 14 Sept", "Tue 15 Sept", "Mon 21 Sept"]);
  });

  // The window is the HOUSE's, so "today" is whatever `groupToday` said in the
  // house's own zone — never the server's. Given a different today, the same
  // turns get different words.
  it("measures today from the house's own day, not the reader's", () => {
    const turns = [shift({ id: 1, due_on: "2026-09-15" })];

    expect(upcomingDays(turns, "2026-09-15")[0].soon).toBe("Today");
    expect(upcomingDays(turns, "2026-09-14")[0].soon).toBe("Tomorrow");
    expect(upcomingDays(turns, "2026-09-13")[0].soon).toBeNull();
  });

  // A month boundary is where civil-date arithmetic done with string maths goes
  // wrong, so it is asserted rather than assumed.
  it("crosses a month end without losing tomorrow", () => {
    const days = upcomingDays([shift({ id: 1, due_on: "2026-10-01" })], "2026-09-30");
    expect(days[0].soon).toBe("Tomorrow");
  });

  it("draws no rows at all for an empty fortnight", () => {
    expect(upcomingDays([], today)).toEqual([]);
  });
});

describe("turnHolder", () => {
  it("names both people on a covered turn", () => {
    const covered = shift({
      id: 1,
      due_on: "2026-09-21",
      covered: true,
      assigned_member: { id: 102, name: "Dan" },
      covering_member: { id: 104, name: "Ciara" },
      responsible_member: { id: 104, name: "Ciara" },
    });

    expect(turnHolder(covered)).toEqual({ name: "Ciara", covering: "covering for Dan" });
  });

  it("names one person on an ordinary turn", () => {
    expect(turnHolder(shift({ id: 1, due_on: "2026-09-14" }))).toEqual({
      name: "Priya",
      covering: null,
    });
  });

  it("says so when the rota had nobody to give the turn to", () => {
    const orphan = shift({
      id: 1,
      due_on: "2026-09-23",
      assigned_member: null,
      responsible_member: null,
    });

    expect(turnHolder(orphan)).toEqual({ name: "Nobody assigned", covering: null });
  });

  // The marker without the name it is covering FOR: better than "covering for
  // undefined", which is what a naive read of `covered` would print.
  it("keeps the holder when a covered turn has lost its assignee", () => {
    const orphanCover = shift({
      id: 1,
      due_on: "2026-09-21",
      covered: true,
      assigned_member: null,
      covering_member: { id: 104, name: "Ciara" },
      responsible_member: { id: 104, name: "Ciara" },
    });

    expect(turnHolder(orphanCover)).toEqual({ name: "Ciara", covering: null });
  });
});

describe("whether a turn is silent", () => {
  const ordinary = shift({ id: 1, due_on: "2026-09-14" });
  const draft = shift({ id: 2, due_on: "2026-09-14", rota_draft: true });
  const paused = shift({ id: 3, due_on: "2026-09-14", rota_active: false });

  it("says nothing about an ordinary turn on a live house", () => {
    expect(turnIsSilent(ordinary)).toBe(false);
    expect(turnSilenceNote(ordinary)).toBeNull();
  });

  // Three reasons, three fixes: resume the house, staff the rota, switch it on.
  // A single "no text will go out" would be true and useless.
  it("tells a draft rota from a paused one from a paused house", () => {
    expect(turnSilenceNote(draft)).toMatch(/nobody is on the roster/);
    expect(turnSilenceNote(paused)).toMatch(/reminder sweep skips it/);
    expect(turnSilenceNote(ordinary, { suspended: true })).toMatch(/house is paused/);
  });

  it("lets a paused house win over the rota's own state", () => {
    expect(turnSilenceNote(draft, { suspended: true })).toMatch(/house is paused/);
    expect(turnIsSilent(ordinary, { suspended: true })).toBe(true);
  });

  // The same three words, in the same tones, as the rotas card two cards over — a
  // turn marked "Paused" beside a rota marked something else is a page describing
  // two different houses.
  it("wears the rotas card's own pill", () => {
    expect(turnRotaState(draft)).toEqual({ label: "Draft", tone: "secondary" });
    expect(turnRotaState(paused)).toEqual({ label: "Paused", tone: "warning" });
    expect(turnRotaState(ordinary)).toEqual({ label: "Running", tone: "success" });
    expect(turnRotaState(ordinary, { suspended: true })).toEqual({
      label: "Running (silent)",
      tone: "success",
    });
  });
});

describe("upcomingWindowNote", () => {
  it("states the window rather than leaving an empty card to speak for itself", () => {
    expect(upcomingWindowNote(14, 0)).toBe("Nothing is due in the next 14 days.");
  });

  it("counts the turns, singular and plural", () => {
    expect(upcomingWindowNote(14, 1)).toContain("1 turn over the next 14 days");
    expect(upcomingWindowNote(14, 5)).toContain("5 turns over the next 14 days");
    // The window is the HOUSE's, measured from its own midnight, and the card
    // says so rather than letting "the next 14 days" read as the operator's.
    expect(upcomingWindowNote(14, 5)).toContain("this house's own calendar");
  });
});

// --- The weekly series ------------------------------------------------------

const weeks: WeeklyWeek[] = [
  { week_start: "2026-08-31", texts: 22, covers: 3 },
  { week_start: "2026-09-07", texts: 25, covers: 1 },
  { week_start: "2026-09-14", texts: 7, covers: 0 },
];

describe("usagePoints", () => {
  it("labels each point with the week it stands for, oldest first", () => {
    expect(usagePoints(weeks, "texts")).toEqual([
      { label: "Week of 31 Aug", value: 22 },
      { label: "Week of 7 Sept", value: 25 },
      { label: "Week of 14 Sept", value: 7 },
    ]);
  });

  // A measured zero is a zero. `null` in a ChartPoint means "not measured" and is
  // drawn as a GAP, which would say something quite different about a quiet week.
  it("keeps a quiet week as zero and never as a gap", () => {
    expect(usagePoints(weeks, "covers").at(-1)).toEqual({ label: "Week of 14 Sept", value: 0 });
  });

  it("draws nothing for a house with no weeks at all", () => {
    expect(usagePoints([], "texts")).toEqual([]);
  });
});

describe("usageTotal", () => {
  it("adds the window up, which both series are event counts and may be", () => {
    expect(usageTotal(weeks, "texts")).toBe(54);
    expect(usageTotal(weeks, "covers")).toBe(4);
  });

  it("is zero, not NaN, for no weeks", () => {
    expect(usageTotal([], "covers")).toBe(0);
  });
});

// --- The log's filters as a URL ---------------------------------------------

describe("the delivery log's filters", () => {
  it("reads nothing off an empty query string", () => {
    expect(parseSmsLogFilters({})).toEqual(NO_SMS_LOG_FILTERS);
  });

  it("reads every filter the API accepts", () => {
    expect(
      parseSmsLogFilters({
        status: "failed",
        kind: "reminder",
        member_id: "104",
        rota_id: "41",
        limit: "200",
      }),
    ).toEqual({ status: "failed", kind: "reminder", memberId: 104, rotaId: 41, limit: 200 });
  });

  // A stale bookmark or a hand-edited URL is ordinary. Forwarding a status Rails
  // does not write would match nothing, and an empty log reads as "this house
  // sent no texts" — the worst wrong answer this page can give.
  it("throws away a value the API would never match", () => {
    expect(
      parseSmsLogFilters({ status: "exploded", kind: "postcard", member_id: "-3", rota_id: "abc" }),
    ).toEqual(NO_SMS_LOG_FILTERS);
  });

  it("clamps a limit to the cap Rails enforces, and ignores a nonsense one", () => {
    expect(parseSmsLogFilters({ limit: "100000" }).limit).toBe(SMS_LOG_MAX_LIMIT);
    expect(parseSmsLogFilters({ limit: "0" }).limit).toBe(SMS_LOG_PAGE);
    expect(parseSmsLogFilters({ limit: "soon" }).limit).toBe(SMS_LOG_PAGE);
  });

  // "?limit=25.5" is a hand-edited URL, and half a row is not a page size Rails
  // can be asked for.
  it("floors a fractional limit", () => {
    expect(parseSmsLogFilters({ limit: "25.5" }).limit).toBe(25);
  });

  it("takes the first of a repeated parameter rather than a comma-joined string", () => {
    expect(parseSmsLogFilters({ status: ["failed", "sent"] }).status).toBe("failed");
  });

  it("spells the plain log as no query string at all", () => {
    expect(smsLogSearchParams(NO_SMS_LOG_FILTERS)).toBe("");
    expect(groupLogHref(12, NO_SMS_LOG_FILTERS)).toBe("/super-admin/groups/12");
  });

  it("omits the default page size, which is a default and not a choice", () => {
    expect(smsLogSearchParams({ ...NO_SMS_LOG_FILTERS, status: "failed" })).toBe("?status=failed");
  });

  // The round trip is the contract: the address bar and the request are two
  // renderings of ONE object, not two hand-built strings that can drift.
  it.each<SmsLogFilters>([
    NO_SMS_LOG_FILTERS,
    { ...NO_SMS_LOG_FILTERS, status: "failed" },
    { ...NO_SMS_LOG_FILTERS, kind: "cover_notice" },
    { ...NO_SMS_LOG_FILTERS, memberId: 104 },
    { ...NO_SMS_LOG_FILTERS, rotaId: 41 },
    { ...NO_SMS_LOG_FILTERS, limit: 300 },
    { status: "delivered", kind: "reminder", memberId: 7, rotaId: 9, limit: SMS_LOG_MAX_LIMIT },
  ])("round-trips %o through the query string", (filters) => {
    const search = new URLSearchParams(smsLogSearchParams(filters));
    const back = parseSmsLogFilters(Object.fromEntries(search.entries()));

    expect(back).toEqual(filters);
  });

  it("knows when something is narrowing the log", () => {
    expect(hasSmsLogFilters(NO_SMS_LOG_FILTERS)).toBe(false);
    // A bigger page is not a filter: it is the same log, further back.
    expect(hasSmsLogFilters({ ...NO_SMS_LOG_FILTERS, limit: 300 })).toBe(false);
    expect(hasSmsLogFilters({ ...NO_SMS_LOG_FILTERS, rotaId: 41 })).toBe(true);
  });
});

describe("nextSmsLogLimit", () => {
  it("grows by whole pages, there being no cursor in this API", () => {
    expect(nextSmsLogLimit(SMS_LOG_PAGE)).toBe(200);
    expect(nextSmsLogLimit(400)).toBe(SMS_LOG_MAX_LIMIT);
  });

  // Null is what makes the button disappear rather than ask for 600 and silently
  // be given 500.
  it("stops at the cap", () => {
    expect(nextSmsLogLimit(SMS_LOG_MAX_LIMIT)).toBeNull();
    expect(nextSmsLogLimit(SMS_LOG_MAX_LIMIT + 100)).toBeNull();
  });
});

describe("smsLogCountNote", () => {
  it("says how much is on screen when that is all there is", () => {
    expect(smsLogCountNote(12, SMS_LOG_PAGE)).toBe("Showing all 12 messages.");
    expect(smsLogCountNote(1, SMS_LOG_PAGE)).toBe("Showing all 1 message.");
  });

  // A full page is the one case where the count is not the answer: it means there
  // are almost certainly older ones.
  it("admits there is probably more when the page filled", () => {
    expect(smsLogCountNote(SMS_LOG_PAGE, SMS_LOG_PAGE)).toContain("probably older ones");
  });

  it("names the cap when the log has hit it", () => {
    expect(smsLogCountNote(SMS_LOG_MAX_LIMIT, SMS_LOG_MAX_LIMIT)).toBe(
      "Showing the most recent 500 messages.",
    );
  });

  it("says nothing rather than zero for an empty log", () => {
    expect(smsLogCountNote(0, SMS_LOG_PAGE)).toBe("No messages.");
  });
});
