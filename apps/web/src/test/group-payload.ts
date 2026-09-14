/**
 * Well-formed `GET /api/super_admin/groups/:id` bodies, and the delivery log
 * beside them: one house in trouble, and one quiet house with nothing in it.
 *
 * Shared rather than copied, for the reason ./traffic-payload.ts gives: two
 * hand-maintained copies drift, and the copy that drifts is always the one in the
 * test that would otherwise have caught the drift. These are also what the
 * screenshots are taken from — the page is behind AuthKit and an operator
 * allowlist, so a fixture is the only way to photograph it.
 *
 * Written as plain JSON (`unknown` in, not the parsed type) on purpose: the tests
 * that use these exercise the PARSE, so a fixture must be able to hold a wrong
 * shape.
 *
 * ONE CLOCK. `FIXTURE_NOW` is a Monday, so the twelve `week_start` Mondays below
 * end on the week it falls in and the fortnight of turns starts on it — which is
 * what makes a screenshot of this page reproducible rather than "whatever today
 * happened to be".
 *
 * The troubled house is built to trip four of the five dashboard warnings at
 * once: an unconfirmed timezone (so it is being texted on a UTC guess), a house
 * calendar that has stopped syncing, a text that failed at the carrier, and a
 * draft rota with nobody on it. That is not an unusual house — it is exactly the
 * shape of the house an operator opens this page to look at.
 *
 * Its four admins are the four shapes `SuperAdmin::AdminSerializer` can emit —
 * named with an address, named without one, unnamed with an address, and neither.
 * Both halves go missing for the same reason (an AuthKit token carries no `name`
 * and no `email` claim unless the WorkOS JWT template adds them), so a house
 * whose first admin signed in before the template was configured has rows like
 * the last two, and they are what blanked the whole page in
 * https://linear.app/bloombase/issue/BLO-1694.
 */

/** The instant every date below is measured from. A Monday, deliberately. */
export const FIXTURE_NOW = new Date("2026-09-14T09:12:00.000Z");

/** The twelve Monday buckets ending in the week `FIXTURE_NOW` falls in. */
const WEEK_STARTS = [
  "2026-06-29",
  "2026-07-06",
  "2026-07-13",
  "2026-07-20",
  "2026-07-27",
  "2026-08-03",
  "2026-08-10",
  "2026-08-17",
  "2026-08-24",
  "2026-08-31",
  "2026-09-07",
  "2026-09-14",
];

// A house that ran hard through July, thinned out in August (two people away) and
// is picking up again. Covers track texts loosely, as they do: a cover is a
// housemate swapping a turn, not a fixed share of the reminders.
const TEXTS = [24, 26, 25, 27, 24, 18, 9, 11, 16, 22, 25, 7];
const COVERS = [2, 1, 3, 0, 2, 0, 0, 1, 2, 3, 1, 1];

const weekly = WEEK_STARTS.map((week_start, index) => ({
  week_start,
  texts: TEXTS[index],
  covers: COVERS[index],
}));

function member(id: number, name: string, phone: string) {
  return { id, name, phone_e164: phone };
}

/**
 * One house in trouble, and the shape every section of the page has something to
 * draw from.
 */
export function groupPayload(): unknown {
  return {
    group: {
      id: 12,
      name: "Alma Terrace",
      slug: "alma-terrace",
      // Unconfirmed, so the system's UTC guess is what this house is texted on —
      // the quietest and most expensive failure the warnings lead with.
      timezone: "UTC",
      timezone_confirmed: false,
      timezone_confirmed_at: null,
      created_at: "2026-05-02T11:04:00.000Z",
      suspended_at: null,
      notes: "Trial house for the school run.\nBilling contact is Priya, not Dan.",
      status: "live",
      // Four, and two of them have no name: `report.admins` below carries every
      // shape `SuperAdmin::AdminSerializer` can emit, and the header's count has
      // to agree with the list under it.
      admins_count: 4,
      active_members_count: 5,
      running_rotas_count: 1,
      paused_rotas_count: 1,
      draft_rotas_count: 1,
      texts_last_7_days: 7,
      unsent_texts_last_7_days: 0,
      failed_texts_last_7_days: 1,
      last_activity_at: "2026-09-14T07:02:00.000Z",
    },
    rotas: [
      {
        id: 41,
        name: "Bins",
        active: true,
        draft: false,
        roster_size: 5,
        starts_on: "2026-05-04",
        interval_count: 1,
        interval_unit: "week",
        send_hour: 18,
        reminder_offsets: [1, 0],
      },
      {
        id: 42,
        name: "Hallway sweep",
        active: false,
        draft: false,
        roster_size: 4,
        starts_on: "2026-05-09",
        interval_count: 2,
        interval_unit: "week",
        send_hour: 9,
        reminder_offsets: [0],
      },
      {
        id: 43,
        name: "Recycling run",
        active: true,
        draft: true,
        roster_size: 0,
        starts_on: "2026-09-07",
        interval_count: 1,
        interval_unit: "month",
        send_hour: 8,
        reminder_offsets: [2, 0],
      },
    ],
    // Not modelled by the schema on purpose — the page draws its log from the
    // filtered endpoint instead — and here so the fixture is a real response.
    recent_sms_messages: [],
    report: {
      warnings_input: {
        group: {
          id: 12,
          name: "Alma Terrace",
          slug: "alma-terrace",
          timezone: "UTC",
          timezone_confirmed: false,
          timezone_confirmed_at: null,
          calendar: {
            calendar_name: "Alma Terrace house",
            masked_url: "https://calendar.google.com/…/basic.ics",
            events_count: 31,
            unclassified_count: 0,
            last_synced_at: "2026-09-09T04:00:00.000Z",
            last_error: "The calendar link returned 404 for the last five checks.",
            failing: true,
          },
        },
        rotas: [
          {
            id: 41,
            name: "Bins",
            message_template: "{{name}}, bins tonight.",
            starts_on: "2026-05-04",
            interval_count: 1,
            interval_unit: "week",
            send_hour: 18,
            reminder_offsets: [1, 0],
            active: true,
            draft: false,
            positions: [
              { member_id: 101, name: "Priya", position: 0 },
              { member_id: 102, name: "Dan", position: 1 },
              { member_id: 103, name: "Mo", position: 2 },
              { member_id: 104, name: "Ciara", position: 3 },
              { member_id: 105, name: "Tomas", position: 4 },
            ],
          },
          {
            id: 42,
            name: "Hallway sweep",
            message_template: "{{name}}, hallway this week.",
            starts_on: "2026-05-09",
            interval_count: 2,
            interval_unit: "week",
            send_hour: 9,
            reminder_offsets: [0],
            active: false,
            draft: false,
            positions: [
              { member_id: 101, name: "Priya", position: 0 },
              { member_id: 103, name: "Mo", position: 1 },
              { member_id: 104, name: "Ciara", position: 2 },
              { member_id: 105, name: "Tomas", position: 3 },
            ],
          },
          {
            id: 43,
            name: "Recycling run",
            message_template: "{{name}}, recycling goes out tomorrow.",
            starts_on: "2026-09-07",
            interval_count: 1,
            interval_unit: "month",
            send_hour: 8,
            reminder_offsets: [2, 0],
            active: true,
            draft: true,
            positions: [],
          },
        ],
        // `::MemberSerializer` WITHOUT `access_token` — the one field
        // SuperAdmin::WarningsInput takes out, because it is a permanent login.
        members: [
          {
            id: 104,
            name: "Ciara",
            phone_e164: "+353871234567",
            active: true,
            contactable: true,
            sms_opted_out_at: null,
          },
          {
            id: 102,
            name: "Dan",
            phone_e164: "+447700900123",
            active: true,
            // Replied STOP and is still on the Bins rota: the "won't get texts"
            // warning.
            contactable: false,
            sms_opted_out_at: "2026-08-21T19:40:00.000Z",
          },
          {
            id: 103,
            name: "Mo",
            phone_e164: "+447700900456",
            active: true,
            contactable: true,
            sms_opted_out_at: null,
          },
          {
            id: 101,
            name: "Priya",
            phone_e164: "+447700900789",
            active: true,
            contactable: true,
            sms_opted_out_at: null,
          },
          {
            id: 106,
            name: "Rosa",
            phone_e164: "+34600111222",
            active: false,
            contactable: false,
            sms_opted_out_at: null,
          },
          {
            id: 105,
            name: "Tomas",
            phone_e164: "+447700900321",
            active: true,
            contactable: true,
            sms_opted_out_at: null,
          },
        ],
        failed_sms: [failedText()],
      },
      upcoming_shifts: [
        {
          id: 9001,
          rota_id: 41,
          rota_name: "Bins",
          rota_active: true,
          rota_draft: false,
          due_on: "2026-09-14",
          covered: false,
          assigned_member: member(103, "Mo", "+447700900456"),
          covering_member: null,
          responsible_member: member(103, "Mo", "+447700900456"),
        },
        {
          id: 9002,
          rota_id: 42,
          rota_name: "Hallway sweep",
          rota_active: false,
          rota_draft: false,
          due_on: "2026-09-16",
          covered: false,
          assigned_member: member(104, "Ciara", "+353871234567"),
          covering_member: null,
          responsible_member: member(104, "Ciara", "+353871234567"),
        },
        {
          id: 9003,
          rota_id: 41,
          rota_name: "Bins",
          rota_active: true,
          rota_draft: false,
          due_on: "2026-09-21",
          // The cover: Ciara has taken Dan's turn. Both names, on the row.
          covered: true,
          assigned_member: member(102, "Dan", "+447700900123"),
          covering_member: member(104, "Ciara", "+353871234567"),
          responsible_member: member(104, "Ciara", "+353871234567"),
        },
        {
          id: 9004,
          rota_id: 43,
          rota_name: "Recycling run",
          rota_active: true,
          rota_draft: true,
          due_on: "2026-09-23",
          covered: false,
          assigned_member: null,
          covering_member: null,
          responsible_member: null,
        },
        {
          id: 9005,
          rota_id: 41,
          rota_name: "Bins",
          rota_active: true,
          rota_draft: false,
          due_on: "2026-09-27",
          covered: false,
          assigned_member: member(101, "Priya", "+447700900789"),
          covering_member: null,
          responsible_member: member(101, "Priya", "+447700900789"),
        },
      ],
      weekly,
      admins: [
        {
          id: 7,
          user_id: 70,
          name: "Priya Raman",
          email: "priya@example.com",
          workos_user_id: "user_01HZY3",
          role: "admin",
          last_seen_at: "2026-09-14T06:40:00.000Z",
          user_sign_in_count: 48,
          user_sign_in_count_30d: 9,
        },
        {
          id: 8,
          user_id: 71,
          name: "Dan Okoro",
          // The placeholder address a JIT provision writes, served as null.
          email: null,
          workos_user_id: "user_01HZY4",
          role: "admin",
          last_seen_at: null,
          user_sign_in_count: 1,
          user_sign_in_count_30d: 0,
        },
        {
          id: 9,
          user_id: 72,
          // WorkOS never sent a name claim either — `users.name` has no NOT NULL
          // and Rails serves what it holds. This is the row that used to blank
          // the entire page with a shape error
          // (https://linear.app/bloombase/issue/BLO-1694), and it is here so that
          // it can never do so again unnoticed.
          name: null,
          email: "rosa@example.com",
          workos_user_id: "user_01HZY5",
          role: "admin",
          last_seen_at: "2026-09-12T18:05:00.000Z",
          user_sign_in_count: 4,
          user_sign_in_count_30d: 4,
        },
        {
          // Neither half: the same token gap produces both at once, so this is
          // the likelier of the two in production rather than the exotic one.
          id: 10,
          user_id: 73,
          name: null,
          email: null,
          workos_user_id: "user_01HZY6",
          role: "admin",
          last_seen_at: null,
          user_sign_in_count: 0,
          user_sign_in_count_30d: 0,
        },
      ],
      members: [
        {
          id: 104,
          name: "Ciara",
          phone_e164: "+353871234567",
          status: "active",
          sms_opted_out_at: null,
          rotas: [{ id: 41, name: "Bins" }, { id: 42, name: "Hallway sweep" }],
          last_seen_at: "2026-09-13T20:15:00.000Z",
        },
        {
          id: 102,
          name: "Dan",
          phone_e164: "+447700900123",
          status: "opted_out",
          sms_opted_out_at: "2026-08-21T19:40:00.000Z",
          rotas: [{ id: 41, name: "Bins" }],
          last_seen_at: "2026-08-21T19:38:00.000Z",
        },
        {
          id: 103,
          name: "Mo",
          phone_e164: "+447700900456",
          status: "active",
          sms_opted_out_at: null,
          rotas: [{ id: 41, name: "Bins" }, { id: 42, name: "Hallway sweep" }],
          last_seen_at: null,
        },
        {
          id: 101,
          name: "Priya",
          phone_e164: "+447700900789",
          status: "active",
          sms_opted_out_at: null,
          rotas: [{ id: 41, name: "Bins" }, { id: 42, name: "Hallway sweep" }],
          last_seen_at: "2026-09-12T08:01:00.000Z",
        },
        {
          id: 106,
          name: "Rosa",
          phone_e164: "+34600111222",
          status: "removed",
          sms_opted_out_at: null,
          rotas: [],
          last_seen_at: "2026-06-30T17:22:00.000Z",
        },
        {
          id: 105,
          name: "Tomas",
          phone_e164: "+447700900321",
          status: "active",
          sms_opted_out_at: null,
          rotas: [{ id: 41, name: "Bins" }, { id: 42, name: "Hallway sweep" }],
          last_seen_at: "2026-09-10T12:44:00.000Z",
        },
      ],
      // Null until https://linear.app/bloombase/issue/BLO-1684 fills it in.
      spend: null,
    },
  };
}

/** The failed text, shared between the warnings input and the log. */
function failedText() {
  return {
    id: 5104,
    kind: "reminder",
    status: "failed",
    error_code: "21610",
    days_before: 0,
    // Already redacted: this is what `SuperAdmin::SmsMessageSerializer` leaves
    // where the magic link was.
    body: "Dan, bins tonight.\nManage: [link]",
    twilio_sid: "SM9f31c0e2",
    sent_at: null,
    created_at: "2026-09-13T17:00:00.000Z",
    member: member(102, "Dan", "+447700900123"),
    shift: { id: 8991, rota_id: 41, rota_name: "Bins", due_on: "2026-09-13" },
  };
}

/**
 * `GET /api/super_admin/groups/:id/sms_messages` — the log behind the busy house,
 * newest first, with every body already redacted.
 */
export function groupSmsLogPayload(): unknown {
  return {
    sms_messages: [
      {
        id: 5108,
        kind: "cover_notice",
        status: "delivered",
        error_code: null,
        days_before: null,
        body: "Ciara is covering your bins turn on Mon 21 Sep.\nManage: [link]",
        twilio_sid: "SM41ab77de",
        sent_at: "2026-09-14T07:02:04.000Z",
        created_at: "2026-09-14T07:02:00.000Z",
        member: member(102, "Dan", "+447700900123"),
        shift: { id: 9003, rota_id: 41, rota_name: "Bins", due_on: "2026-09-21" },
      },
      {
        id: 5107,
        kind: "reminder",
        status: "delivered",
        error_code: null,
        days_before: 0,
        body: "Mo, bins tonight.\nManage: [link]",
        twilio_sid: "SM41ab77dd",
        sent_at: "2026-09-14T06:00:09.000Z",
        created_at: "2026-09-14T06:00:00.000Z",
        member: member(103, "Mo", "+447700900456"),
        shift: { id: 9001, rota_id: 41, rota_name: "Bins", due_on: "2026-09-14" },
      },
      {
        id: 5106,
        kind: "member_login",
        status: "delivered",
        error_code: null,
        days_before: null,
        body: "Your Rota Monster personal link: [link]",
        twilio_sid: "SM41ab77dc",
        sent_at: "2026-09-13T20:14:30.000Z",
        created_at: "2026-09-13T20:14:00.000Z",
        member: member(104, "Ciara", "+353871234567"),
        shift: null,
      },
      {
        id: 5105,
        kind: "reminder",
        status: "pending",
        error_code: null,
        days_before: 1,
        // Never sent, so there is no body at all. Null and not "" — an empty
        // string would read as "we sent a blank text".
        body: null,
        twilio_sid: null,
        sent_at: null,
        created_at: "2026-09-13T18:00:00.000Z",
        member: member(105, "Tomas", "+447700900321"),
        shift: { id: 9005, rota_id: 41, rota_name: "Bins", due_on: "2026-09-27" },
      },
      failedText(),
    ],
  };
}

/**
 * A house where nothing has happened: created last week, one admin, nobody added,
 * no rota, no texts. Every section's empty state at once, which is the other half
 * of what this page has to look right in.
 */
export function quietGroupPayload(): unknown {
  return {
    group: {
      id: 31,
      name: "Nelson Road",
      slug: "nelson-road",
      timezone: "Europe/London",
      timezone_confirmed: true,
      timezone_confirmed_at: "2026-09-08T10:02:00.000Z",
      created_at: "2026-09-08T09:58:00.000Z",
      suspended_at: null,
      notes: null,
      status: "never_started",
      admins_count: 1,
      active_members_count: 0,
      running_rotas_count: 0,
      paused_rotas_count: 0,
      draft_rotas_count: 0,
      texts_last_7_days: 0,
      unsent_texts_last_7_days: 0,
      failed_texts_last_7_days: 0,
      last_activity_at: "2026-09-08T10:02:00.000Z",
    },
    rotas: [],
    recent_sms_messages: [],
    report: {
      warnings_input: {
        group: {
          id: 31,
          name: "Nelson Road",
          slug: "nelson-road",
          timezone: "Europe/London",
          timezone_confirmed: true,
          timezone_confirmed_at: "2026-09-08T10:02:00.000Z",
          calendar: null,
        },
        rotas: [],
        members: [],
        failed_sms: [],
      },
      upcoming_shifts: [],
      // Zero-filled by Rails, so a house that has sent nothing draws a flat line
      // rather than a shorter sparkline.
      weekly: WEEK_STARTS.map((week_start) => ({ week_start, texts: 0, covers: 0 })),
      admins: [
        {
          id: 19,
          user_id: 90,
          name: "Sam Wilde",
          email: "sam@example.com",
          workos_user_id: "user_01J2AA",
          role: "admin",
          last_seen_at: "2026-09-08T10:02:00.000Z",
          user_sign_in_count: 2,
          user_sign_in_count_30d: 2,
        },
      ],
      members: [],
      spend: null,
    },
  };
}

/** The quiet house's log: there isn't one. */
export function emptySmsLogPayload(): unknown {
  return { sms_messages: [] };
}
