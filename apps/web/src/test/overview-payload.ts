/**
 * One well-formed `GET /api/super_admin/overview` body, shared by the schema's
 * own tests and by the client's.
 *
 * Shared rather than copied so there is exactly ONE idea of what Rails renders in
 * the web tests. Two hand-maintained copies drift, and the copy that drifts is
 * always the one in the test that would otherwise have caught the drift.
 *
 * Written as plain JSON (`unknown` in, not the parsed type) on purpose: these
 * tests exercise the PARSE, so the fixture must be able to hold a wrong shape.
 */
function base() {
  return {
    generated_at: "2026-09-13T09:12:04.000Z",
    kpis: {
      houses_total: 42,
      houses_active_last_30_days: 31,
      houses_new_this_week: 3,
      texts_last_7_days: 430,
      texts_delivered_last_7_days: 397,
      texts_failed_last_7_days: 15,
      texts_settled_last_7_days: 412,
      delivery_rate_last_7_days: 96.4,
      covers_this_week: 7,
    },
    attention: [
      { group_id: 12, name: "Alma Road", slug: "alma-road", reason: "failed_texts", count: 3 },
      {
        group_id: 8,
        name: "Bell Street",
        slug: "bell-street",
        reason: "unconfirmed_timezone",
        count: null,
      },
    ],
    attention_total: 2,
    recent_houses: [
      {
        group_id: 12,
        name: "Alma Road",
        slug: "alma-road",
        timezone: "Europe/London",
        timezone_confirmed: true,
        created_at: "2026-09-11T08:00:00.000Z",
        furthest_step: "delivered_text",
        furthest_step_number: 5,
      },
    ],
    system_health: {
      jobs: [
        {
          name: "reminder_sweep",
          last_finished_at: "2026-09-13T09:00:11.000Z",
          succeeded: true,
          error_class: null,
        },
        {
          name: "top_up_shift_windows",
          last_finished_at: null,
          succeeded: null,
          error_class: null,
        },
        {
          name: "sync_house_calendars",
          last_finished_at: "2026-09-13T08:27:30.000Z",
          succeeded: false,
          error_class: "Faraday::TimeoutError",
        },
      ],
      queue_failed_executions: 0,
    },
    spend: null,
  };
}

/** The fixture's shape, so a test can destructure it without casting. */
export type OverviewFixture = ReturnType<typeof base>;

/**
 * The payload, with any key replaced. The cast is deliberate: a test's whole job
 * here is to hand `parseOverview` a WRONG shape and watch it refuse, so the
 * overrides are unknown going in while the result stays destructurable.
 */
export function overviewPayload(overrides: Record<string, unknown> = {}): OverviewFixture {
  return { ...base(), ...overrides } as OverviewFixture;
}
