/**
 * Well-formed `GET /api/super_admin/traffic` bodies: one busy month, and one
 * from a product nothing has happened on yet.
 *
 * Shared rather than copied, for the reason ./overview-payload.ts gives: two
 * hand-maintained copies drift, and the copy that drifts is always the one in
 * the test that would otherwise have caught the drift. These are also what the
 * screenshots are taken from — the page is behind AuthKit and an allowlist, so
 * a fixture is the only way to photograph it.
 *
 * Written as plain JSON (`unknown` in, not the parsed type) on purpose: these
 * tests exercise the PARSE, so the fixture must be able to hold a wrong shape.
 *
 * Every figure below is internally consistent the way Rails' own are — kinds add
 * up to `texts_sent`, `texts_settled` is delivered plus failed, each rate is its
 * own quotient at one decimal, and the failure shares are of `total` including
 * the uncoded ones. A fixture that does not add up teaches the wrong thing about
 * the page.
 */

type Week = {
  week_starting: string;
  reminder: number;
  cover_notice: number;
  member_login: number;
  delivered: number;
  failed: number;
  delivery_rate: number | null;
  active_houses: number;
  active_users: number;
  members_last_seen: number;
  new_houses: number;
};

function week(w: Week) {
  const sent = w.reminder + w.cover_notice + w.member_login;

  return {
    week_starting: w.week_starting,
    texts_sent: sent,
    texts_by_kind: {
      reminder: w.reminder,
      cover_notice: w.cover_notice,
      member_login: w.member_login,
    },
    texts_delivered: w.delivered,
    texts_failed: w.failed,
    texts_settled: w.delivered + w.failed,
    delivery_rate: w.delivery_rate,
    covers: w.cover_notice,
    active_houses: w.active_houses,
    active_users: w.active_users,
    members_last_seen: w.members_last_seen,
    new_houses: w.new_houses,
  };
}

/**
 * Thirty days of a product that is working: six Monday buckets (the first one
 * partial, because no range is snapped to a Monday), a step whose rate is over
 * 100%, a week with no texts at all and therefore NO delivery rate, and five
 * failure codes plus a handful that carry none.
 */
export function trafficPayload() {
  return {
    range: "30d",
    starts_at: "2026-08-15T09:12:04.000Z",
    ends_at: "2026-09-14T09:12:04.000Z",
    generated_at: "2026-09-14T09:12:04.000Z",

    funnel: [
      {
        step: 1,
        key: "landing_views",
        unit: "views",
        tracked: true,
        count: 1420,
        // Nothing above it to be a share of. Its note takes the bar's footnote
        // slot instead, which is why the fixture carries a real one.
        rate_from_previous: null,
        note: "browser visits only: crawlers and clients without JavaScript are missed, so this undercounts",
      },
      {
        step: 2,
        key: "signed_in",
        unit: "users",
        tracked: true,
        count: 184,
        // 184 of 1420, to one decimal.
        rate_from_previous: 13.0,
        note: null,
      },
      {
        step: 3,
        key: "made_house",
        unit: "houses",
        tracked: true,
        count: 96,
        rate_from_previous: 52.2,
        note: null,
      },
      {
        // Over 100% on purpose: `timezone_confirmed_at` is re-stamped every time
        // an admin saves the house settings, so an established house walks into
        // this step without ever having been in step 3's count. The page must
        // show it rather than cap it.
        step: 4,
        key: "confirmed_timezone",
        unit: "houses",
        tracked: true,
        count: 103,
        rate_from_previous: 107.3,
        note: null,
      },
      {
        step: 5,
        key: "added_member",
        unit: "houses",
        tracked: true,
        count: 74,
        rate_from_previous: 71.8,
        note: null,
      },
      {
        step: 6,
        key: "started_rota",
        unit: "houses",
        tracked: true,
        count: 61,
        rate_from_previous: 82.4,
        note: null,
      },
      {
        step: 7,
        key: "delivered_text",
        unit: "houses",
        tracked: true,
        count: 52,
        rate_from_previous: 85.2,
        note: null,
      },
      {
        step: 8,
        key: "first_cover",
        unit: "houses",
        tracked: true,
        count: 23,
        rate_from_previous: 44.2,
        note: null,
      },
    ],

    median_hours_to_first_text: 18.5,
    median_hours_sample: 27,
    signed_in_without_house: 63,

    weeks: [
      // The partial first week: the window opens mid-week and nothing settled,
      // so there is no delivery rate to draw. A gap, never a zero.
      week({
        week_starting: "2026-08-10",
        reminder: 0,
        cover_notice: 0,
        member_login: 0,
        delivered: 0,
        failed: 0,
        delivery_rate: null,
        active_houses: 0,
        active_users: 6,
        members_last_seen: 1,
        new_houses: 2,
      }),
      week({
        week_starting: "2026-08-17",
        reminder: 186,
        cover_notice: 14,
        member_login: 12,
        delivered: 201,
        failed: 8,
        delivery_rate: 96.2,
        active_houses: 24,
        active_users: 41,
        members_last_seen: 3,
        new_houses: 9,
      }),
      week({
        week_starting: "2026-08-24",
        reminder: 235,
        cover_notice: 19,
        member_login: 14,
        delivered: 249,
        failed: 14,
        delivery_rate: 94.7,
        active_houses: 29,
        active_users: 46,
        members_last_seen: 5,
        new_houses: 12,
      }),
      week({
        week_starting: "2026-08-31",
        reminder: 271,
        cover_notice: 22,
        member_login: 17,
        delivered: 301,
        failed: 6,
        delivery_rate: 98.0,
        active_houses: 33,
        active_users: 52,
        members_last_seen: 8,
        new_houses: 15,
      }),
      week({
        week_starting: "2026-09-07",
        reminder: 296,
        cover_notice: 28,
        member_login: 17,
        delivered: 318,
        failed: 19,
        delivery_rate: 94.4,
        active_houses: 37,
        active_users: 58,
        members_last_seen: 14,
        new_houses: 11,
      }),
      // The current, partial week. `members_last_seen` spikes here because it is
      // a moving column: everyone seen at all recently lands in this bucket.
      week({
        week_starting: "2026-09-14",
        reminder: 84,
        cover_notice: 8,
        member_login: 4,
        delivered: 88,
        failed: 3,
        delivery_rate: 96.7,
        active_houses: 31,
        active_users: 44,
        members_last_seen: 41,
        new_houses: 4,
      }),
    ],

    // 45 coded failures plus 5 with no code = the 50 failed texts in the weeks
    // above. The shares are of 50, so the five rows add up to 90%, not 100.
    /**
     * Where those 1420 visits came from. The referrers add up to 812, well short
     * of 1420, because a direct arrival carries no referrer at all: the panel's
     * own coverage line is what explains the gap, and a fixture whose columns
     * summed to the funnel's step 1 would never exercise it.
     *
     * `countries` is EMPTY on purpose. It is the state of production today —
     * the domain is DNS-only on Cloudflare, so the `cf-ipcountry` header is
     * never sent — and the one empty state on this page that must not read as
     * "nobody visited". A fixture that filled it in would photograph a column
     * that does not exist yet.
     */
    visits: {
      referrers: [
        { host: "news.ycombinator.com", count: 341 },
        { host: "www.google.com", count: 228 },
        { host: "www.reddit.com", count: 146 },
        { host: "t.co", count: 61 },
        { host: "mumsnet.com", count: 36 },
      ],
      countries: [],
      devices: [
        { device: "mobile", count: 806 },
        { device: "desktop", count: 559 },
        { device: "tablet", count: 55 },
      ],
    },

    failures: {
      total: 50,
      uncoded: 5,
      top: [
        { error_code: "30003", count: 14, share: 28.0 },
        { error_code: "30006", count: 11, share: 22.0 },
        { error_code: "21610", count: 9, share: 18.0 },
        { error_code: "30007", count: 7, share: 14.0 },
        { error_code: "30005", count: 4, share: 8.0 },
      ],
    },
  };
}

/**
 * Day one: the range is real, the weeks are all there, and every figure in them
 * is zero.
 *
 * The state every chart has to survive — no maximum to measure a bar against, no
 * total to split a stacked row by, no rate to draw a line through — and the one
 * an operator sees on the morning the page ships.
 */
export function emptyTrafficPayload() {
  const payload = trafficPayload();

  return {
    ...payload,
    funnel: payload.funnel.map((step) => ({
      ...step,
      count: 0,
      rate_from_previous: null,
    })),
    median_hours_to_first_text: null,
    median_hours_sample: 0,
    signed_in_without_house: 0,
    visits: { referrers: [], countries: [], devices: [] },
    weeks: payload.weeks.map((w) => ({
      ...w,
      texts_sent: 0,
      texts_by_kind: { reminder: 0, cover_notice: 0, member_login: 0 },
      texts_delivered: 0,
      texts_failed: 0,
      texts_settled: 0,
      delivery_rate: null,
      covers: 0,
      active_houses: 0,
      active_users: 0,
      members_last_seen: 0,
      new_houses: 0,
    })),
    failures: { total: 0, uncoded: 0, top: [] },
  };
}
