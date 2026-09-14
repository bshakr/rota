import { describe, expect, it } from "vitest";

import { TEXT_KINDS, TRAFFIC_FUNNEL_STEPS, VISIT_DIMENSIONS } from "./api/super-admin-traffic";
import { FUNNEL_STEP_LABELS } from "./hq-overview";
import {
  BROWSER_LABELS,
  DEVICE_LABELS,
  OS_LABELS,
  RANGE_LABELS,
  TEXT_KIND_SERIES,
  TRAFFIC_STEP_LABELS,
  VISIT_COLUMNS,
  WEEKLY_SIGNALS,
  failuresNote,
  formatMedianHours,
  formatShare,
  funnelRateNote,
  leakNote,
  medianHoursNote,
  parseRange,
  rangeHref,
  visitsCoverageNote,
  weekLabel,
  weekOfLabel,
} from "./hq-traffic";

describe("parseRange", () => {
  it("takes the three windows the picker offers", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("90d")).toBe("90d");
  });

  it("shows thirty days when the URL says nothing", () => {
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange("")).toBe("30d");
  });

  // Rails answers 400 for a range it does not know. A stale bookmark or a
  // hand-edited URL should get thirty days of figures, not an error page — and
  // must never be forwarded to the API as-is.
  it("falls back rather than forwarding a range Rails would refuse", () => {
    expect(parseRange("6m")).toBe("30d");
    expect(parseRange("7")).toBe("30d");
    expect(parseRange("30D")).toBe("30d");
    expect(parseRange("../admin")).toBe("30d");
  });

  // Next hands back an array when a parameter is repeated, which a link cannot
  // produce and a person can.
  it("takes the first value when the parameter is repeated", () => {
    expect(parseRange(["90d", "7d"])).toBe("90d");
    expect(parseRange([])).toBe("30d");
  });

  it("spells a range's href once, so a deep link and the picker agree", () => {
    expect(rangeHref("90d")).toBe("/super-admin/traffic?range=90d");
  });

  it("has a label for every range", () => {
    expect(Object.keys(RANGE_LABELS)).toEqual(["7d", "30d", "90d"]);
  });
});

describe("the funnel's words", () => {
  it("names all eight steps", () => {
    expect(Object.keys(TRAFFIC_STEP_LABELS).sort()).toEqual([...TRAFFIC_FUNNEL_STEPS].sort());
  });

  // The same ladder counted two ways: one house's furthest rung on the overview,
  // every house's count here. Two names for one rung would be a bug waiting to
  // be argued about.
  it("reads the shared rungs exactly as the overview does", () => {
    for (const [step, label] of Object.entries(FUNNEL_STEP_LABELS)) {
      expect(TRAFFIC_STEP_LABELS[step as keyof typeof FUNNEL_STEP_LABELS]).toBe(label);
    }
  });
});

describe("funnelRateNote", () => {
  const previous = { label: "Signed in", tracked: true, count: 184 };

  it("says what share of the step above reached this one, at one decimal", () => {
    expect(funnelRateNote(52.2, previous)).toBe("52.2% of \u201cSigned in\u201d");
  });

  // Project rule, BLO-1454: a figure never renders coarser than it was computed.
  it("never rounds a rate to a whole percent", () => {
    expect(funnelRateNote(96.0, previous)).toBe("96.0% of \u201cSigned in\u201d");
    expect(funnelRateNote(41.66, previous)).toBe("41.7% of \u201cSigned in\u201d");
  });

  // Step 4 does this routinely: `timezone_confirmed_at` is re-stamped on every
  // settings save, so an established house lands in it without ever having been
  // in step 3's count. Capping it at 100% would hide the reason the funnel looks
  // odd.
  it("shows a rate over 100% rather than capping it, and says what it means", () => {
    expect(funnelRateNote(107.3, previous)).toBe(
      "107.3% of \u201cSigned in\u201d — more arrived here than above",
    );
    // Exactly 100 is not "over": every house above made it through.
    expect(funnelRateNote(100, previous)).toBe("100.0% of \u201cSigned in\u201d");
  });

  // Half the ladder's labels are verb phrases, so a sentence built around one
  // reads as broken English: "nobody a reminder arrived". Quoting the bar is what
  // keeps every one of the eight rows a sentence.
  it("quotes the step above rather than trying to conjugate it", () => {
    const arrived = { label: "A reminder arrived", tracked: true, count: 52 };

    expect(funnelRateNote(44.2, arrived)).toBe("44.2% of \u201cA reminder arrived\u201d");
    expect(funnelRateNote(null, { ...arrived, count: 0 })).toBe(
      "No rate — nothing reached \u201cA reminder arrived\u201d",
    );
  });

  it("has nothing to say about the first step, which has nothing above it", () => {
    expect(funnelRateNote(null, null)).toBeNull();
  });

  // Two different reasons for a missing rate, and they are not the same fact.
  it("tells an uncounted step above apart from an empty one", () => {
    expect(funnelRateNote(null, { label: "Landed on the site", tracked: false, count: null })).toBe(
      "No rate yet — \u201cLanded on the site\u201d isn't counted",
    );
    expect(funnelRateNote(null, { label: "Signed in", tracked: true, count: 0 })).toBe(
      "No rate — nothing reached \u201cSigned in\u201d",
    );
  });
});

describe("the figures beside the funnel", () => {
  it("prints hours at one decimal", () => {
    expect(formatMedianHours(18.5)).toBe("18.5h");
    expect(formatMedianHours(0.4)).toBe("0.4h");
  });

  it("switches to days once hours stop being readable", () => {
    expect(formatMedianHours(48)).toBe("2.0 days");
    expect(formatMedianHours(68.4)).toBe("2.9 days");
  });

  // "Not enough data" and "no time at all" are opposite facts.
  it("says so when there is no median to show, rather than 0h", () => {
    expect(formatMedianHours(null)).toBe("—");
    expect(medianHoursNote(null, 0)).toBe("Not enough data in this range");
  });

  it("publishes the sample beside the median, because it is survivorship-biased", () => {
    expect(medianHoursNote(18.5, 27)).toBe("from 27 houses that got there");
    expect(medianHoursNote(18.5, 1)).toBe("from 1 house that got there");
  });

  it("frames the leak, and says when there isn't one", () => {
    expect(leakNote(63)).toBe("Got through the door and no further");
    expect(leakNote(0)).toBe("Everybody who signed in made a house");
  });
});

describe("the weekly series", () => {
  it("labels a bucket by the Monday it starts on", () => {
    expect(weekLabel("2026-09-07")).toBe("7 Sept");
    expect(weekOfLabel("2026-08-31")).toBe("Week of 31 Aug");
  });

  // The API sends a plain date. Parsing it into an instant and formatting that
  // in a zone behind UTC prints the day before, which would make every Monday
  // bucket a Sunday.
  it("reads the date as a calendar date rather than as an instant", () => {
    expect(weekLabel("2026-01-01")).toBe("1 Jan");
    expect(weekLabel("2026-12-28")).toBe("28 Dec");
  });

  it("has a segment for every kind of text Rails splits by", () => {
    expect(TEXT_KIND_SERIES.map((series) => series.kind).sort()).toEqual([...TEXT_KINDS].sort());
  });

  // Reminder (lilac, hue 290) and cover notice (sky, hue 234) are the closest
  // two hues in the set — under the dataviz validator's normal-vision floor — so
  // the peach segment sits between them and they never share an edge.
  it("keeps the two closest hues apart in the stack", () => {
    const order = TEXT_KIND_SERIES.map((series) => series.kind);

    expect(Math.abs(order.indexOf("reminder") - order.indexOf("cover_notice"))).toBeGreaterThan(1);
  });

  it("gives every series its own tone", () => {
    const tones = TEXT_KIND_SERIES.map((series) => series.tone);

    expect(new Set(tones).size).toBe(tones.length);
  });

  // The one series that would mislead without its words: `members_last_seen` is
  // a moving column, so it rises towards today whatever the members did.
  it("labels the moving column as most recently seen", () => {
    const members = WEEKLY_SIGNALS.find((signal) => signal.key === "members_last_seen");

    expect(members?.label).toBe("Members most recently seen");
    expect(members?.note).toContain("LAST seen");
    expect(members?.summable).toBe(false);
  });

  // A distinct count of houses cannot be added across weeks: the same house
  // active every week is one house, not thirteen.
  it("only totals the series that are events rather than distinct counts", () => {
    const summable = WEEKLY_SIGNALS.filter((signal) => signal.summable).map(
      (signal) => signal.key as string,
    );

    expect(summable).toEqual(["covers", "new_houses"]);
  });
});

describe("failures", () => {
  it("prints a share at one decimal, and a dash when there is nothing to share", () => {
    expect(formatShare(28)).toBe("28.0%");
    expect(formatShare(7.25)).toBe("7.3%");
    expect(formatShare(null)).toBe("—");
  });

  // The shares are all of `total`, which includes the failures that carry no
  // code — so the five rows visibly do not add up to a hundred, and the line
  // under the table says why.
  it("says what the top five leaves out", () => {
    expect(failuresNote(50, 5, 45)).toBe("50 failed texts · 5 with no code — shares are of all 50");
    expect(failuresNote(80, 5, 45)).toBe(
      "80 failed texts · 5 with no code · 30 under other codes — shares are of all 80",
    );
    expect(failuresNote(45, 0, 45)).toBe("45 failed texts — shares are of all 45");
  });

  it("says nothing failed rather than printing an empty table's arithmetic", () => {
    expect(failuresNote(0, 0, 0)).toBe("No text failed in this window");
  });
});

describe("where the visits came from", () => {
  it("names the three device classes in the product's words", () => {
    expect(DEVICE_LABELS).toEqual({ mobile: "Phone", tablet: "Tablet", desktop: "Computer" });
  });

  // A family and never a version, written the way a person writes it. "Ios" and
  // "Macos" would look like a page that does not know what it is talking about.
  it("names each browser and system family the way it is spelt", () => {
    expect(BROWSER_LABELS.samsung).toBe("Samsung Internet");
    expect(OS_LABELS.ios).toBe("iOS");
    expect(OS_LABELS.macos).toBe("macOS");

    for (const label of [...Object.values(BROWSER_LABELS), ...Object.values(OS_LABELS)]) {
      expect(label, `${label} carries a version`).not.toMatch(/\d/);
    }
  });

  // Every column has a heading and a line for when it is empty, so a column
  // added to the payload cannot reach the page unlabelled.
  it("has words for all six columns", () => {
    expect([...VISIT_DIMENSIONS].sort()).toEqual(Object.keys(VISIT_COLUMNS).sort());

    for (const column of Object.values(VISIT_COLUMNS)) {
      expect(column.heading).not.toBe("");
      expect(column.empty).not.toBe("");
    }
  });

  // THE POINT OF THE CONSTANT. An empty city column is not "nobody visited from
  // anywhere": the `cf-ipcity` header only arrives once the Cloudflare zone's
  // visitor location headers are switched on, so the column is empty however
  // busy the site is. One "no data" line everywhere would turn a configuration
  // fact into an apparent absence of traffic and contradict the funnel's first
  // bar directly above it. The country column carried this warning until the
  // domain was proxied and the country started arriving on every visit.
  it("says something different in the two columns that are empty for their own reasons", () => {
    expect(VISIT_COLUMNS.cities.empty).toMatch(/Cloudflare/);
    expect(VISIT_COLUMNS.cities.empty).not.toMatch(/no visit/i);
    expect(VISIT_COLUMNS.referrers.empty).toMatch(/no referrer/i);
    // Not the city's sentence any more. The header arrives now.
    expect(VISIT_COLUMNS.countries.empty).not.toMatch(/Cloudflare/);
  });

  // One decimal, like every other rate on this page: a figure never renders
  // coarser than it was computed. Both counts go through formatCount, so the
  // sentence and the tables above it separate thousands the same way.
  it("says how many visits arrived from another site", () => {
    expect(visitsCoverageNote(903, 1420)).toBe(
      "903 of 1,420 visits arrived from another site (63.6%). The rest carried no referrer, which can mean a typed address, a link from a text, or a browser that withheld it.",
    );
    expect(visitsCoverageNote(1, 1)).toBe(
      "1 of 1 visit arrived from another site (100.0%). The rest carried no referrer, which can mean a typed address, a link from a text, or a browser that withheld it.",
    );
  });

  // The sentence used to say the rest arrived DIRECTLY, and that was a claim the
  // data cannot support: a referrer is also missing when the referring page's
  // policy withholds it, and when the visit came from one of our own pages and
  // the browser dropped it before the event was sent.
  it("never claims the visits without a referrer were direct", () => {
    expect(visitsCoverageNote(903, 1420)).not.toMatch(/arrived directly/);
    expect(visitsCoverageNote(903, 1420)).toMatch(/withheld it/);
  });

  it("says nobody visited rather than dividing by an empty window", () => {
    expect(visitsCoverageNote(0, 0)).toBe("No visit was counted in this window.");
  });
});
