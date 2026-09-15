import { describe, expect, it } from "vitest";

import { emptyTrafficPayload, trafficPayload as payload } from "@/test/traffic-payload";

import { FUNNEL_STEPS } from "./super-admin-overview";
import {
  BROWSER_FAMILIES,
  DEVICE_CLASSES,
  OS_FAMILIES,
  TEXT_KINDS,
  TRAFFIC_FUNNEL_STEPS,
  TRAFFIC_RANGES,
  TrafficShapeError,
  VISIT_DIMENSIONS,
  WEEK_SERIES,
  isTrafficShapeError,
  parseTraffic,
} from "./super-admin-traffic";

// The lists, copied BY HAND from the Rails source that emits them:
//
//   apps/api/app/queries/super_admin/traffic.rb
//     RANGE_DAYS = { "7d" => 7, "30d" => 30, "90d" => 90 }
//     STEPS      = [[landing_views, views], [signed_in, users], [made_house, houses],
//                   [confirmed_timezone, houses], [added_member, houses],
//                   [started_rota, houses], [delivered_text, houses], [first_cover, houses]]
//     KINDS      = SmsMessage::KINDS.values  →  reminder, cover_notice, member_login
//     weeks      = week_starting, texts_sent, texts_by_kind, texts_delivered, texts_failed,
//                  texts_settled, delivery_rate, covers, active_houses, active_users,
//                  members_last_seen, new_houses
//
//     VISIT_DIMENSIONS = { referrers:, countries:, cities:, devices:, browsers:,
//                          operating_systems: }
//
//   apps/api/app/models/sms_message.rb
//     KINDS = { reminder:, cover_notice:, member_login: }
//
//   apps/api/app/models/analytics_event.rb
//     DEVICE_CLASSES   = %w[mobile tablet desktop]
//     BROWSER_FAMILIES = %w[chrome safari firefox edge samsung other]
//     OS_FAMILIES      = %w[ios android macos windows linux other]
//
// Hardcoded rather than read off disk on purpose, exactly as
// super-admin-overview.test.ts does it. The point is not to re-derive the lists
// — it is that nobody can widen, narrow or REORDER one without editing this copy
// of the Ruby beside it, which means opening the Ruby. Order is contractual: a
// step's `step` number is its 1-based index into STEPS, each rate is measured
// against the step above it, and the stacked bars are drawn in KINDS order.
const RUBY_RANGES = ["7d", "30d", "90d"];
const RUBY_STEPS = [
  "landing_views",
  "signed_in",
  "made_house",
  "confirmed_timezone",
  "added_member",
  "started_rota",
  "delivered_text",
  "first_cover",
];
const RUBY_KINDS = ["reminder", "cover_notice", "member_login"];
const RUBY_VISIT_DIMENSIONS = [
  "referrers",
  "countries",
  "cities",
  "devices",
  "browsers",
  "operating_systems",
];
const RUBY_DEVICE_CLASSES = ["mobile", "tablet", "desktop"];
const RUBY_BROWSER_FAMILIES = ["chrome", "safari", "firefox", "edge", "samsung", "other"];
const RUBY_OS_FAMILIES = ["ios", "android", "macos", "windows", "linux", "other"];
const RUBY_WEEK_KEYS = [
  "week_starting",
  "texts_sent",
  "texts_by_kind",
  "texts_delivered",
  "texts_failed",
  "texts_settled",
  "delivery_rate",
  "covers",
  "active_houses",
  "active_users",
  "members_last_seen",
  "new_houses",
];

/** The payload with one week figure removed — the drift this parse exists to catch. */
function weeksWithout(key: string) {
  const body = payload();
  const weeks = body.weeks.map((week) => {
    const copy: Record<string, unknown> = { ...week };
    delete copy[key];
    return copy;
  });
  return { ...body, weeks };
}

describe("the traffic payload's key lists", () => {
  it("offers the three ranges Rails accepts, in the order the picker shows them", () => {
    expect([...TRAFFIC_RANGES]).toEqual(RUBY_RANGES);
  });

  it("lists the eight funnel steps in ladder order", () => {
    expect([...TRAFFIC_FUNNEL_STEPS]).toEqual(RUBY_STEPS);
  });

  it("lists the kinds of text the stacked bars split by", () => {
    expect([...TEXT_KINDS]).toEqual(RUBY_KINDS);
  });

  it("names every weekly series the page draws", () => {
    expect(["week_starting", "texts_by_kind", ...WEEK_SERIES].sort()).toEqual(
      [...RUBY_WEEK_KEYS].sort(),
    );
  });

  // Rails gives steps 3 to 8 the same keys as the overview's onboarding ladder,
  // deliberately: one house's furthest rung and this funnel's counts across all
  // houses are the same ladder counted two ways. Two names for one rung would be
  // a bug waiting to be argued about, and hq-traffic.ts reuses the overview's
  // labels on the strength of this.
  it("shares its last six rungs with the overview's ladder, in the same order", () => {
    expect(TRAFFIC_FUNNEL_STEPS.slice(2)).toEqual([...FUNNEL_STEPS]);
  });

  it("numbers a step by its place in the ladder", () => {
    expect(TRAFFIC_FUNNEL_STEPS[7 - 1]).toBe("delivered_text");
  });
});

describe("parseTraffic", () => {
  it("reads a well-formed payload back with its figures intact", () => {
    const traffic = parseTraffic(payload());

    expect(traffic.range).toBe("30d");
    expect(traffic.funnel).toHaveLength(8);
    expect(traffic.weeks).toHaveLength(6);
    expect(traffic.weeks.at(-1)?.texts_by_kind.cover_notice).toBe(8);
    expect(traffic.failures.top[0]).toEqual({ error_code: "30003", count: 14, share: 28 });
  });

  it("reads a payload from a product nothing has happened on yet", () => {
    const traffic = parseTraffic(emptyTrafficPayload());

    expect(traffic.median_hours_to_first_text).toBeNull();
    expect(traffic.weeks.every((week) => week.delivery_rate === null)).toBe(true);
    expect(traffic.failures.top).toEqual([]);
  });

  // Unknown keys are stripped, not rejected: Rails ADDING a key is not a reason
  // to blank this screen. It is a key that goes MISSING that this catches.
  it("ignores a key Rails has added that this page does not read yet", () => {
    const traffic = parseTraffic({ ...payload(), page_views: 9_000 });

    expect(traffic).not.toHaveProperty("page_views");
  });

  it.each(["texts_sent", "delivery_rate", "covers", "active_users", "members_last_seen"])(
    "refuses a payload whose weeks lost %s rather than rendering it as nothing",
    (key) => {
      expect(() => parseTraffic(weeksWithout(key))).toThrow(TrafficShapeError);
    },
  );

  it("names every field that disagreed, with its path", () => {
    try {
      parseTraffic(weeksWithout("covers"));
      expect.unreachable("a payload with no covers should not parse");
    } catch (error) {
      expect(isTrafficShapeError(error)).toBe(true);
      expect((error as TrafficShapeError).issues.join(" ")).toContain("weeks.0.covers");
    }
  });

  it("refuses a range Rails would have answered 400 for", () => {
    expect(() => parseTraffic({ ...payload(), range: "6m" })).toThrow(TrafficShapeError);
  });

  // A short funnel means a step quietly stopped being counted — and a bar that
  // is not there cannot look wrong.
  it("refuses a funnel with a rung missing", () => {
    const body = payload();
    expect(() => parseTraffic({ ...body, funnel: body.funnel.slice(1) })).toThrow(TrafficShapeError);
  });

  it("refuses a funnel whose steps have been reordered", () => {
    const body = payload();
    const funnel = [body.funnel[1], body.funnel[0], ...body.funnel.slice(2)];

    expect(() => parseTraffic({ ...body, funnel })).toThrow(/ladder has "landing_views"/);
  });

  // `tracked` decides whether the page draws a bar or prints why there is none,
  // and `count` is what it draws. A payload where the two disagree renders a
  // confident bar over a step nobody is counting, or hides a step that has a
  // real figure. Asserted in both directions.
  it("refuses a step whose tracked flag disagrees with its count", () => {
    const body = payload();

    const uncounted = body.funnel.map((step) =>
      step.key === "landing_views" ? { ...step, tracked: false } : step,
    );
    expect(() => parseTraffic({ ...body, funnel: uncounted })).toThrow(/tracked/);

    const claimed = body.funnel.map((step) =>
      step.key === "signed_in" ? { ...step, count: null } : step,
    );
    expect(() => parseTraffic({ ...body, funnel: claimed })).toThrow(/tracked/);
  });

  // Every chart draws the weeks left to right in array order, so a shuffled
  // series renders a plausible chart of the wrong weeks.
  it("refuses weeks that are not oldest-first", () => {
    const body = payload();

    expect(() => parseTraffic({ ...body, weeks: [...body.weeks].reverse() })).toThrow(
      /does not come after/,
    );
  });

  it("refuses a rate that arrived as a string", () => {
    const body = payload();
    const weeks = body.weeks.map((week) => ({ ...week, delivery_rate: "96.4" }));

    expect(() => parseTraffic({ ...body, weeks })).toThrow(TrafficShapeError);
  });

  // Above 100% is a FACT about a short window, not a broken payload: a house made
  // by somebody who signed in last month, or an established house re-saving its
  // timezone. The page shows it; the schema must not stand in the way.
  it("accepts a step that converted above 100%", () => {
    const traffic = parseTraffic(payload());

    expect(traffic.funnel[3].rate_from_previous).toBe(107.3);
  });

  describe("where the visits came from", () => {
    // Order included. It is the order the page draws the columns in, and it is
    // what puts "where from" on one row and "what on" on the next.
    it("names the six columns Rails names, in Rails' order", () => {
      expect([...VISIT_DIMENSIONS]).toEqual(RUBY_VISIT_DIMENSIONS);
      expect([...DEVICE_CLASSES]).toEqual(RUBY_DEVICE_CLASSES);
      expect([...BROWSER_FAMILIES]).toEqual(RUBY_BROWSER_FAMILIES);
      expect([...OS_FAMILIES]).toEqual(RUBY_OS_FAMILIES);
    });

    it("narrows each column to its own row shape", () => {
      const traffic = parseTraffic(payload());

      expect(traffic.visits.referrers[0]).toEqual({ host: "news.ycombinator.com", count: 341 });
      expect(traffic.visits.countries[0]).toEqual({ code: "GB", count: 1044 });
      expect(traffic.visits.cities[0]).toEqual({ city: "London", count: 412 });
      expect(traffic.visits.devices[0]).toEqual({ device: "mobile", count: 806 });
      expect(traffic.visits.browsers[0]).toEqual({ browser: "chrome", count: 614 });
      expect(traffic.visits.operating_systems[0]).toEqual({ os: "ios", count: 521 });
    });

    // A family and never a version. The enum is what makes that structural
    // rather than a promise: a payload carrying "chrome 141" cannot be parsed,
    // so it can never reach the page and be drawn as a bar of its own.
    it("refuses a browser or a system that is a version rather than a family", () => {
      const body = payload();

      expect(() =>
        parseTraffic({
          ...body,
          visits: { ...body.visits, browsers: [{ browser: "chrome 141", count: 3 }] },
        }),
      ).toThrow(/browsers/);
      expect(() =>
        parseTraffic({
          ...body,
          visits: { ...body.visits, operating_systems: [{ os: "macOS 15.6", count: 3 }] },
        }),
      ).toThrow(/operating_systems/);
    });

    // The figure the panel's sentence is built from. Rails counts it ungrouped
    // over every visit that carried a referrer, and the list stops at ten hosts,
    // so it is NOT the sum of the rows and the two diverge as soon as there is a
    // tail. The fixture keeps them apart on purpose.
    it("carries a referred count that is not the sum of the rows", () => {
      const traffic = parseTraffic(payload());
      const shown = traffic.visits.referrers.reduce((sum, row) => sum + row.count, 0);

      expect(traffic.visits.referred_count).toBe(903);
      expect(traffic.visits.referred_count).toBeGreaterThan(shown);
    });

    it("refuses a payload whose visits carry no referred count", () => {
      const body = payload();
      const visits: Record<string, unknown> = { ...body.visits };
      delete visits.referred_count;

      expect(() => parseTraffic({ ...body, visits })).toThrow(/referred_count/);
    });

    // The other ungrouped figure, and the fixture keeps the two apart for the
    // same reason: they are separate counts over the same rows and nothing makes
    // them equal, so a page that read one for the other would look right.
    it("carries a visitor count that is its own number", () => {
      const traffic = parseTraffic(payload());

      expect(traffic.visits.unique_visitors).toBe(887);
      expect(traffic.visits.unique_visitors).not.toBe(traffic.visits.referred_count);
    });

    it("refuses a payload whose visits carry no visitor count", () => {
      const body = payload();
      const visits: Record<string, unknown> = { ...body.visits };
      delete visits.unique_visitors;

      expect(() => parseTraffic({ ...body, visits })).toThrow(/unique_visitors/);
    });

    // Nought visitors is a REAL state — a window older than the visitor code, or
    // a deploy with no shared secret — so the schema must take it. The words are
    // hq-traffic.ts's problem; the shape must not stand in the way of them.
    it("takes nought visitors beside a healthy view count", () => {
      const body = payload();

      expect(parseTraffic({ ...body, visits: { ...body.visits, unique_visitors: 0 } }).visits
        .unique_visitors).toBe(0);
    });

    // An empty column is a real state, not a broken payload: no visit carries a
    // city until Cloudflare's visitor location headers are switched on for the
    // zone, and on day one no visit carries anything at all. A schema that
    // demanded a row would turn either into a blank dashboard.
    it("accepts a column with nothing in it", () => {
      const empty = parseTraffic(emptyTrafficPayload()).visits;

      expect(empty.cities).toEqual([]);
      expect(empty.devices).toEqual([]);
      expect(empty.operating_systems).toEqual([]);
    });

    // `device` is a closed set in Rails, so a fourth word is a deploy skew rather
    // than a new kind of visitor, and the page has no label to draw it with.
    it("refuses a device class nobody defined", () => {
      const body = payload();
      const visits = { ...body.visits, devices: [{ device: "fridge", count: 1 }] };

      expect(() => parseTraffic({ ...body, visits })).toThrow(TrafficShapeError);
    });

    it("refuses more rows than Rails will ever send", () => {
      const body = payload();
      const referrers = Array.from({ length: 11 }, (_, index) => ({
        host: `host${index}.example.com`,
        count: 1,
      }));

      expect(() => parseTraffic({ ...body, visits: { ...body.visits, referrers } })).toThrow(
        TrafficShapeError,
      );
    });

    it("refuses a payload with no visits at all, which is a deploy skew", () => {
      const body: Record<string, unknown> = payload();
      delete body.visits;

      expect(() => parseTraffic(body)).toThrow(/visits/);
    });
  });
});
