import { describe, expect, it } from "vitest";

import { emptyTrafficPayload, trafficPayload as payload } from "@/test/traffic-payload";

import { FUNNEL_STEPS } from "./super-admin-overview";
import {
  TEXT_KINDS,
  TRAFFIC_FUNNEL_STEPS,
  TRAFFIC_RANGES,
  TrafficShapeError,
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
//   apps/api/app/models/sms_message.rb
//     KINDS = { reminder:, cover_notice:, member_login: }
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
});
