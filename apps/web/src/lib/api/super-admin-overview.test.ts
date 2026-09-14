import { describe, expect, it } from "vitest";

import { overviewPayload as payload } from "@/test/overview-payload";

import {
  ATTENTION_REASONS,
  FUNNEL_STEPS,
  JOB_NAMES,
  OverviewShapeError,
  isOverviewShapeError,
  parseOverview,
} from "./super-admin-overview";

// The three key unions, copied BY HAND from the Rails source that emits them:
//
//   apps/api/app/queries/super_admin/overview.rb
//     REASONS      = %w[failed_texts unconfirmed_timezone only_draft_rotas opted_out_member]
//     FUNNEL_STEPS = %w[made_house confirmed_timezone added_member started_rota
//                       delivered_text first_cover]
//
//   apps/api/app/models/job_run.rb
//     MONITORED    = [ REMINDER_SWEEP, TOP_UP_SHIFT_WINDOWS, SYNC_HOUSE_CALENDARS ]
//                  = %w[reminder_sweep top_up_shift_windows sync_house_calendars]
//
// Hardcoded rather than read off disk on purpose. The point is not to re-derive
// the lists — it is that nobody can widen, narrow or REORDER a union on this side
// without editing this copy of the Ruby beside it, which means opening the Ruby.
// Order is part of the contract twice over: the attention list is rendered in
// REASONS order, and a house's step number is its 1-based index into FUNNEL_STEPS.
const RUBY_REASONS = [
  "failed_texts",
  "unconfirmed_timezone",
  "only_draft_rotas",
  "opted_out_member",
];
const RUBY_FUNNEL_STEPS = [
  "made_house",
  "confirmed_timezone",
  "added_member",
  "started_rota",
  "delivered_text",
  "first_cover",
];
const RUBY_JOB_NAMES = ["reminder_sweep", "top_up_shift_windows", "sync_house_calendars"];

/** The KPI block with one figure removed — the drift this parse exists to catch. */
function kpisWithout(key: string): Record<string, unknown> {
  const kpis: Record<string, unknown> = { ...payload().kpis };
  delete kpis[key];
  return kpis;
}

describe("the overview payload's key unions", () => {
  it("lists the attention reasons Rails emits, in Rails' order", () => {
    expect([...ATTENTION_REASONS]).toEqual(RUBY_REASONS);
  });

  it("lists the funnel steps Rails derives, in ladder order", () => {
    expect([...FUNNEL_STEPS]).toEqual(RUBY_FUNNEL_STEPS);
  });

  it("lists the monitored jobs, in the order the health tile reads them", () => {
    expect([...JOB_NAMES]).toEqual(RUBY_JOB_NAMES);
  });

  // The step number in the payload is `FUNNEL_STEPS.index(step) + 1`, so a union
  // that has drifted out of order would mislabel every house on the page rather
  // than fail — the one drift that is invisible on screen.
  it("agrees with Rails about which rung each step number names", () => {
    expect(FUNNEL_STEPS[5 - 1]).toBe("delivered_text");
    expect(FUNNEL_STEPS.length).toBe(RUBY_FUNNEL_STEPS.length);
  });
});

describe("parseOverview", () => {
  it("accepts the payload Rails renders", () => {
    const overview = parseOverview(payload());

    expect(overview.kpis.delivery_rate_last_7_days).toBe(96.4);
    expect(overview.attention[1].count).toBeNull();
    expect(overview.recent_houses[0].furthest_step).toBe("delivered_text");
    expect(overview.system_health.jobs[1].last_finished_at).toBeNull();
    expect(overview.spend).toBeNull();
  });

  // Rails adding a key is not a reason to blank the operator's landing page.
  it("ignores keys it does not know about", () => {
    const parsed = parseOverview(payload({ future_tile: { anything: true } }));

    expect(parsed).not.toHaveProperty("future_tile");
  });

  it("throws a named error when a figure has gone missing", () => {
    expect(() => parseOverview(payload({ kpis: kpisWithout("texts_settled_last_7_days") }))).toThrow(
      OverviewShapeError,
    );
  });

  // The whole reason this is parsed rather than cast: an absent number would
  // render as a blank or a zero that looks exactly like a real fact.
  it("names the field that disagreed, so the fix is not a hunt", () => {
    try {
      parseOverview(payload({ kpis: kpisWithout("texts_settled_last_7_days") }));
      expect.unreachable("expected a shape error");
    } catch (error) {
      expect(isOverviewShapeError(error)).toBe(true);
      expect((error as OverviewShapeError).issues.join(" ")).toContain(
        "kpis.texts_settled_last_7_days",
      );
    }
  });

  it("refuses an attention reason the page has no words for", () => {
    const attention = [
      { group_id: 12, name: "Alma Road", slug: "alma-road", reason: "on_fire", count: 1 },
    ];

    expect(() => parseOverview(payload({ attention }))).toThrow(OverviewShapeError);
  });

  it("refuses a funnel step the ladder does not contain", () => {
    const recent_houses = [{ ...payload().recent_houses[0], furthest_step: "invoiced" }];

    expect(() => parseOverview(payload({ recent_houses }))).toThrow(OverviewShapeError);
  });

  it("refuses a job the health tile has no label for", () => {
    const jobs = payload().system_health.jobs.map((job, index) =>
      index === 0 ? { ...job, name: "vacuum_the_hall" } : job,
    );

    expect(() =>
      parseOverview(payload({ system_health: { ...payload().system_health, jobs } })),
    ).toThrow(OverviewShapeError);
  });

  // Rails builds this list by mapping JobRun::MONITORED, so a name with no runs
  // behind it still appears. A short array means a job stopped being monitored —
  // and a row that is not there cannot look wrong, so the tile would render as if
  // all were well.
  it("refuses a health tile with a job missing from it", () => {
    const jobs = payload().system_health.jobs.slice(0, 2);

    expect(() =>
      parseOverview(payload({ system_health: { ...payload().system_health, jobs } })),
    ).toThrow(OverviewShapeError);
  });

  // The pips are drawn from the number and the caption from the step. A payload
  // where they disagree draws four filled pips over the words "a reminder
  // arrived" and looks entirely plausible, which is why it is refused rather than
  // rendered.
  it("refuses a house whose step number disagrees with its step", () => {
    const recent_houses = [{ ...payload().recent_houses[0], furthest_step_number: 2 }];

    expect(() => parseOverview(payload({ recent_houses }))).toThrow(
      /furthest_step_number.*delivered_text.*rung 5/,
    );
  });

  it("refuses a rung past the end of the ladder", () => {
    const recent_houses = [{ ...payload().recent_houses[0], furthest_step_number: 7 }];

    expect(() => parseOverview(payload({ recent_houses }))).toThrow(OverviewShapeError);
  });

  // A rate of 0 and a rate of null are opposite facts, so the schema keeps both
  // reachable — it is `undefined` that must never get through.
  it("keeps a null delivery rate distinct from a zero one", () => {
    const zero = parseOverview(
      payload({ kpis: { ...payload().kpis, delivery_rate_last_7_days: 0 } }),
    );
    const none = parseOverview(
      payload({ kpis: { ...payload().kpis, delivery_rate_last_7_days: null } }),
    );

    expect(zero.kpis.delivery_rate_last_7_days).toBe(0);
    expect(none.kpis.delivery_rate_last_7_days).toBeNull();
  });

  // The queue lives in its own database and can fail to answer on its own.
  it("keeps an unreadable queue distinct from an empty one", () => {
    const unknown = parseOverview(
      payload({
        system_health: { ...payload().system_health, queue_failed_executions: null },
      }),
    );

    expect(unknown.system_health.queue_failed_executions).toBeNull();
  });

  // `spend` was `z.null()` — a tripwire so the ticket that filled it had to widen
  // the schema and build the tile in the same change.
  // https://linear.app/bloombase/issue/BLO-1684 is that ticket. What the union
  // now accepts is exactly the tile's shape, and what it still refuses is a
  // half-shaped one: the page derives these figures from the spend endpoint
  // today, and the union is what lets Rails start inlining them without a second
  // type or a second deploy.
  it("still refuses a spend payload the tile could not render", () => {
    expect(() => parseOverview(payload({ spend: { this_month: 12.5 } }))).toThrow(
      OverviewShapeError,
    );
  });

  it("accepts the tile's own shape, and still accepts the null Rails sends today", () => {
    const spend = {
      range: "90d",
      currency: "USD",
      this_month: { month: "2026-09", sms_cost: 2.9273, claude_cost: 0.36963, total: 3.29693 },
      last_month: { month: "2026-08", sms_cost: 5.5415, claude_cost: 0.784, total: 6.3255 },
    };

    expect(parseOverview(payload({ spend })).spend?.this_month.total).toBe(3.29693);
    expect(parseOverview(payload()).spend).toBeNull();
  });

  it("refuses a body that is not the payload at all", () => {
    expect(() => parseOverview({})).toThrow(OverviewShapeError);
    expect(() => parseOverview(null)).toThrow(OverviewShapeError);
    expect(() => parseOverview("<html>502</html>")).toThrow(OverviewShapeError);
  });
});
