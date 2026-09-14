import { describe, expect, it } from "vitest";

import {
  DEFAULT_GROUP_SORT,
  GROUPS_HREF,
  GROUP_SORTS,
  GROUP_SORT_DIRECTION,
  GROUP_STATUSES,
  GROUP_STATUS_PILL,
  type GroupsFilters,
  MEMBER_STATUSES,
  MEMBER_STATUS_PILL,
  NOTES_MAX,
  NO_FILTERS,
  groupsHref,
  groupsQuery,
  groupsSearchParams,
  hasNarrowingFilters,
  housePausedBody,
  housePausedTitle,
  memberRotasNote,
  notesCounter,
  parseGroupsFilters,
  reminderOffsetsInWords,
  rosterNote,
  rotaCountsNote,
  rotaStateLabel,
  scheduleInWords,
  sendHourInWords,
  textTroubleNote,
  timezoneNote,
  workosUserUrl,
} from "./hq-groups";
import { CONTACT_EMAIL } from "./site";

// The Ruby lists, hardcoded rather than imported, exactly as
// super-admin-overview.test.ts hardcodes Overview's. A test that reads a union
// from the same module the code reads it from cannot notice a rename on the Rails
// side; a test that spells it out fails the moment somebody widens, narrows or
// REORDERS one — and order is contractual here twice over, since it is the status
// precedence and the order the filter offers.
describe("the unions Rails owns", () => {
  it("matches SuperAdmin::GroupStatus, in its precedence order", () => {
    expect([...GROUP_STATUSES]).toEqual(["suspended", "never_started", "quiet", "live"]);
  });

  it("matches SuperAdmin::MemberSerializer's three states", () => {
    expect([...MEMBER_STATUSES]).toEqual(["removed", "opted_out", "active"]);
  });

  it("matches SuperAdmin::GroupsController::SORTS, and its default", () => {
    expect([...GROUP_SORTS]).toEqual(["name", "created", "last_activity", "texts"]);
    expect(DEFAULT_GROUP_SORT).toBe("name");
  });

  // Which way each one actually runs, read off the Ruby lambdas: `name` sorts on
  // the name itself (A to Z), and the other three negate their key, which is
  // descending. A header drawing a down arrow over an alphabetical column would
  // be the page stating the opposite of what the API did, so the direction is
  // data rather than a guess in the component.
  it("knows which way each order runs", () => {
    expect(GROUP_SORT_DIRECTION).toEqual({
      name: "ascending",
      created: "descending",
      last_activity: "descending",
      texts: "descending",
    });
  });

  it("has a direction for every sort the API accepts, and no others", () => {
    expect(Object.keys(GROUP_SORT_DIRECTION).sort()).toEqual([...GROUP_SORTS].sort());
  });

  it("has a pill for every status and every member state", () => {
    for (const status of GROUP_STATUSES) expect(GROUP_STATUS_PILL[status].label).toBeTruthy();
    for (const status of MEMBER_STATUSES) expect(MEMBER_STATUS_PILL[status].label).toBeTruthy();
  });

  // Suspended is the one status somebody DECIDED, so it wears the loud sticker
  // and must never wear `destructive` — that variant is the blush "went wrong"
  // sticker, and nothing went wrong when an operator paused a house on purpose.
  it("gives Suspended the loud sticker and never the went-wrong one", () => {
    expect(GROUP_STATUS_PILL.suspended).toEqual({ label: "Suspended", tone: "default" });
  });
});

describe("filters, read off the URL", () => {
  it("reads a full query string", () => {
    expect(
      parseGroupsFilters({
        q: "alma",
        status: "quiet",
        unconfirmed_timezone: "1",
        has_failures: "true",
        sort: "texts",
      }),
    ).toEqual({
      q: "alma",
      status: "quiet",
      unconfirmedTimezone: true,
      hasFailures: true,
      sort: "texts",
    });
  });

  it("is the unfiltered list for an empty query string", () => {
    expect(parseGroupsFilters({})).toEqual(NO_FILTERS);
  });

  // A stale bookmark or a hand-edited URL is ordinary. Rails would silently fall
  // back to sorting by name while the header claimed "Texts", so the page must
  // never forward a value the API does not have.
  it("drops a status or a sort the API has never heard of", () => {
    const filters = parseGroupsFilters({ status: "archived", sort: "spend" });
    expect(filters.status).toBeNull();
    expect(filters.sort).toBe(DEFAULT_GROUP_SORT);
  });

  it("trims the search term, so one term is one address", () => {
    expect(parseGroupsFilters({ q: "  alma  " }).q).toBe("alma");
    expect(parseGroupsFilters({ q: "   " }).q).toBe("");
  });

  it("accepts the flag spellings a hand-written URL might carry", () => {
    for (const value of ["1", "true", "on", "yes"]) {
      expect(parseGroupsFilters({ has_failures: value }).hasFailures).toBe(true);
    }
    for (const value of ["0", "false", "", "off"]) {
      expect(parseGroupsFilters({ has_failures: value }).hasFailures).toBe(false);
    }
  });

  it("takes the first value when a param repeats", () => {
    expect(parseGroupsFilters({ status: ["live", "quiet"] }).status).toBe("live");
  });
});

describe("filters, written back as a query string", () => {
  const filters = (overrides: Partial<GroupsFilters> = {}): GroupsFilters => ({
    ...NO_FILTERS,
    ...overrides,
  });

  // Defaults are omitted every time. A URL that spells out `sort=name&q=` for the
  // plain list cannot be told apart from a filtered one at a glance, and makes
  // "are any filters on?" a question about string length.
  it("is empty for the unfiltered list", () => {
    expect(groupsSearchParams(NO_FILTERS)).toBe("");
    expect(groupsHref(NO_FILTERS)).toBe(GROUPS_HREF);
  });

  it("omits the default sort but keeps any other", () => {
    expect(groupsSearchParams(filters({ sort: "name" }))).toBe("");
    expect(groupsSearchParams(filters({ sort: "created" }))).toBe("?sort=created");
  });

  it("writes the flags as 1 and only when they are on", () => {
    expect(groupsSearchParams(filters({ unconfirmedTimezone: true }))).toBe(
      "?unconfirmed_timezone=1",
    );
    expect(groupsSearchParams(filters({ hasFailures: false }))).toBe("");
  });

  it("keeps a fixed order, so one state is always one address", () => {
    expect(
      groupsSearchParams(
        filters({
          q: "alma road",
          status: "live",
          unconfirmedTimezone: true,
          hasFailures: true,
          sort: "texts",
        }),
      ),
    ).toBe("?q=alma+road&status=live&unconfirmed_timezone=1&has_failures=1&sort=texts");
  });

  it("round-trips: what the bar writes is what the page reads", () => {
    const original = filters({ q: "alma", status: "quiet", hasFailures: true, sort: "created" });
    const params = Object.fromEntries(new URLSearchParams(groupsSearchParams(original)));
    expect(parseGroupsFilters(params)).toEqual(original);
  });

  it("hands the API the same state, under the API's own key names", () => {
    expect(
      groupsQuery(filters({ q: "alma", status: "live", unconfirmedTimezone: true })),
    ).toEqual({
      q: "alma",
      status: "live",
      unconfirmed_timezone: true,
      has_failures: undefined,
      sort: "name",
    });
  });

  // Which empty state the page shows turns on this: "no houses yet" and "nothing
  // matched" are different facts and must not share a screen.
  it("knows whether anything is narrowing the list", () => {
    expect(hasNarrowingFilters(NO_FILTERS)).toBe(false);
    expect(hasNarrowingFilters(filters({ sort: "texts" }))).toBe(false);
    expect(hasNarrowingFilters(filters({ q: "alma" }))).toBe(true);
    expect(hasNarrowingFilters(filters({ status: "quiet" }))).toBe(true);
    expect(hasNarrowingFilters(filters({ unconfirmedTimezone: true }))).toBe(true);
    expect(hasNarrowingFilters(filters({ hasFailures: true }))).toBe(true);
  });
});

describe("a rota, in words", () => {
  it("names the recurrence and where the rotation is counted from", () => {
    expect(scheduleInWords({ starts_on: "2026-07-05", interval_count: 1, interval_unit: "week" })).toBe(
      "Every week, from Sun 5 Jul",
    );
    expect(scheduleInWords({ starts_on: "2026-07-05", interval_count: 2, interval_unit: "week" })).toBe(
      "Every 2 weeks, from Sun 5 Jul",
    );
    expect(scheduleInWords({ starts_on: "2026-01-31", interval_count: 3, interval_unit: "month" })).toBe(
      "Every 3 months, from Sat 31 Jan",
    );
  });

  // Offset 0 is "on the day" and never "0 days before" — the house's own rota
  // screens already decided that, and this reuses their helper rather than
  // spelling a rota differently from the screen its admin is looking at.
  it("lists the reminders longest lead first", () => {
    expect(reminderOffsetsInWords([0, 2])).toBe("2 days before, on the day");
    expect(reminderOffsetsInWords([1])).toBe("1 day before");
    expect(reminderOffsetsInWords([])).toBe("No reminders");
  });

  it("renders the send hour on a 24-hour clock", () => {
    expect(sendHourInWords(9)).toBe("texts at 09:00");
    expect(sendHourInWords(0)).toBe("texts at 00:00");
    expect(sendHourInWords(18)).toBe("texts at 18:00");
  });

  it("tells draft, paused and running apart", () => {
    expect(rotaStateLabel({ active: true, draft: true }).label).toBe("Draft");
    expect(rotaStateLabel({ active: false, draft: true }).label).toBe("Draft");
    expect(rotaStateLabel({ active: false, draft: false }).label).toBe("Paused");
    expect(rotaStateLabel({ active: true, draft: false }).label).toBe("Running");
  });

  // A suspended house's rotas are still running — nothing was switched off, and
  // resuming puts them straight back — and are still sending nothing, because the
  // sweep does not visit them. A bare "Running" pill would answer the operator's
  // main question with the wrong answer, inches from the header that gave the
  // right one.
  it("says a running rota is silent while the house is paused", () => {
    expect(rotaStateLabel({ active: true, draft: false }, { suspended: true }).label).toBe(
      "Running (silent)",
    );
  });

  // Only the running one changes. A draft sends nothing because nobody is on it
  // and a paused rota because it was switched off; neither becomes more or less
  // true when the house is suspended, and marking them would blur three distinct
  // reasons for silence into one.
  it("leaves draft and paused rotas alone", () => {
    expect(rotaStateLabel({ active: true, draft: true }, { suspended: true }).label).toBe("Draft");
    expect(rotaStateLabel({ active: false, draft: false }, { suspended: true }).label).toBe(
      "Paused",
    );
  });

  it("says outright when nobody is on a rota", () => {
    expect(rosterNote(0)).toBe("Nobody on it");
    expect(rosterNote(1)).toBe("1 person on it");
    expect(rosterNote(4)).toBe("4 people on it");
  });
});

describe("the list's own sentences", () => {
  it("marks an unconfirmed timezone and says nothing about a confirmed one", () => {
    expect(timezoneNote(false)).toBe("Never confirmed");
    expect(timezoneNote(true)).toBeNull();
  });

  // A single total hides a stuck queue, which is exactly what this list exists to
  // surface, so the two failures are told apart.
  it("tells a refused text from a stranded one", () => {
    expect(textTroubleNote(3, 0)).toBe("3 failed");
    expect(textTroubleNote(0, 2)).toBe("2 never sent");
    expect(textTroubleNote(3, 2)).toBe("3 failed, 2 never sent");
  });

  // Null, not "0 failed": a zero rendered in the trouble slot reads as a figure
  // worth looking at.
  it("says nothing at all when nothing went wrong", () => {
    expect(textTroubleNote(0, 0)).toBeNull();
  });

  it("counts running, paused and draft rotas separately", () => {
    expect(rotaCountsNote(2, 1, 3)).toBe("2 running, 1 paused, 3 drafts");
    expect(rotaCountsNote(1, 0, 1)).toBe("1 running, 1 draft");
    expect(rotaCountsNote(0, 0, 0)).toBe("None yet");
  });
});

describe("people", () => {
  it("links an admin to the WorkOS dashboard by their WorkOS id", () => {
    expect(workosUserUrl("user_01H")).toBe("https://dashboard.workos.com/users/user_01H");
  });

  it("names the rotas a housemate sits on, and says when there are none", () => {
    expect(memberRotasNote([{ name: "Bins" }, { name: "Kitchen" }])).toBe("Bins, Kitchen");
    expect(memberRotasNote([])).toBe("On no rota");
  });
});

describe("the notes counter", () => {
  it("matches the ceiling Rails enforces", () => {
    expect(NOTES_MAX).toBe(2000);
  });

  // Counts what is LEFT. The reader only cares about the number when they are
  // close to the edge, and "1,847 of 2,000" makes them do the subtraction there.
  it("counts down, with a thousands separator", () => {
    expect(notesCounter("")).toEqual({ text: "2,000 left", over: false });
    expect(notesCounter("a".repeat(153))).toEqual({ text: "1,847 left", over: false });
  });

  it("is not over at exactly the limit", () => {
    expect(notesCounter("a".repeat(NOTES_MAX))).toEqual({ text: "0 left", over: false });
  });

  // "0 left" and "47 too many" ask for different amounts of editing, so over the
  // limit the counter says by how much rather than sticking at zero.
  it("says by how much when the box is over", () => {
    expect(notesCounter("a".repeat(NOTES_MAX + 47))).toEqual({
      text: "47 over the 2,000 limit",
      over: true,
    });
  });
});

describe("the paused screen's copy", () => {
  it("names the house in the title when the surface knows it", () => {
    expect(housePausedTitle("Alma Road")).toBe("Alma Road is paused");
  });

  it("falls back to the house-voice sentence when it does not", () => {
    expect(housePausedTitle(null)).toBe("This house is paused");
  });

  // The way back off this screen. It is the one screen where the reader cannot
  // look the address up in the app, so the sentence has to carry it: the halves
  // exist only so the component can put a real mailto link between them, and
  // this asserts they still close around an address into one sentence.
  it("puts the address inside the sentence, not after it", () => {
    expect(housePausedBody(CONTACT_EMAIL)).toBe(
      "Nothing is lost. Email hello@bloombase.studio to pick it back up.",
    );
  });

  // Hardcoded, not read from the constant, because the address is a decision
  // (Bass, 2026-09-14) and a real mailbox somebody has to be reading. A test
  // that took it from the same constant the code takes it from could not notice
  // it being changed to one that bounces.
  it("writes to the studio mailbox, never a rota.monster or ritualpass address", () => {
    expect(CONTACT_EMAIL).toBe("hello@bloombase.studio");
  });
});
