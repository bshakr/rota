# Sentry error logging: production readiness plan

Status: phases 1 and 2 implemented on 2026-09-13 (see the verification section at
the end); nothing is deployed yet and the Sentry-side work in phases 3 and 4 remains.
It is the plan for taking both apps from "errors go to a Railway log nobody is watching" to "every
unexpected exception reaches Sentry, is symbolicated, carries the release and the
household it happened in, wakes a human, and never carries a member's token or phone
number". Read [`household-entry.md`](household-entry.md) for the shape a finished
slice of this plan should be documented in.

Verified against: `sentry-ruby` / `sentry-rails` 7.0.0 (latest on RubyGems today),
`@sentry/nextjs` 10.74.0 (peer range includes Next 16), `solid_queue` 1.4.0 (locked),
Rails 8.1.3.1, Next.js 16.2.10.

## 1. Where we are

The codebase already expects Sentry. It has been written around a reporter that is not
there yet, and it says so:

- `apps/api/app/jobs/reminder_sweep_job.rb` and `top_up_shift_windows_job.rb` call
  `Rails.error.report(e, context: { rota_id: }, source: "rotamonster.…")` inside a
  per-rota rescue. The comment on both reads "`Rails.error` has no subscribers in this
  app yet, so `report` alone is a no-op". The log line next to it is the only alarm.
- `SendSmsJob` has a catch-all `rescue StandardError` that marks the row
  `internal_error` and writes one log line. The `retry_on` exhaustion block records the
  carrier code and reports nothing. Five failed attempts at texting Alice produce zero
  events anywhere.
- `Authenticatable` turns a WorkOS key-set outage into a 503 and a log line. Every
  admin is locked out for the duration and nobody is paged.
- Solid Queue's own thread errors go to `Rails.error.report(exception, handled: false)`
  (the default in `solid_queue` 1.4.0's engine). Also a no-op today.
- `apps/web/src/app/error.tsx` says "Once observability lands this is where it
  reports" and calls `console.error`. `h/[slug]/error.tsx` drops the error entirely.
  `confirm-dialog.tsx` swallows a rejected confirm into `console.error`. There is no
  `global-error.tsx`, so a root-layout failure is a white page with no record.
- Production Rails logs to STDOUT tagged with `request_id`; Railway keeps them. That is
  the whole of production observability today.

The failure this product is most afraid of is spelled out in the job comments: a house
that quietly stops being texted while every dashboard stays green. That is the failure
class this plan is built to make loud.

## 2. Goals and non-goals

Goals, in priority order:

1. Every unhandled exception in either app reaches Sentry within seconds, in
   production, with release, environment, request id and household attached.
2. The handled-but-serious paths that already call `Rails.error.report`, and the ones
   that should (SMS retry exhaustion, WorkOS key-set outage, an invalid template
   reaching send time), produce events too.
3. The two recurring jobs are cron-monitored, so a dead worker is an alert, not an
   empty SMS log discovered three days later.
4. No member access token, phone number, WorkOS JWT, AuthKit session cookie or Twilio
   credential is ever sent to Sentry. This is a hard constraint, tested on both sides.
5. `bin/ci` and `npm run ci` stay green with no Sentry account, no DSN and no auth
   token. Development never sends. Test never touches the network (WebMock already
   enforces this for Rails; the plan keeps it true).
6. Alerts reach a person. Sentry with no alert rule is a nicer log.

Non-goals for this plan, decided rather than forgotten:

- Session Replay: no. The member and admin pages render names and phone numbers.
  Replay masks text by default but the benefit does not justify the risk on a product
  whose whole privacy story is "the token and the number never leave the server".
- Profiling: no.
- Performance tracing: off in phase 1 (`traces_sample_rate` 0), a small sample in
  phase 4 once the error side is trusted. Errors first.
- Shipping Rails logs into Sentry Logs: optional, phase 4. Railway logs stay the source
  of truth for "what happened at 03:00".

## 3. The privacy contract

This is the section to read twice. The codebase has already done the work of keeping
credentials out of URLs, logs and client bundles, and Sentry is a new sink that can
undo all of it in one event. Each row is a secret, where the SDK would pick it up by
default, and what stops it.

| Secret | Default leak path | Control |
| --- | --- | --- |
| Member access token (permanent bearer credential) | Browser SDK records `window.location` and navigation breadcrumbs on `/s/<token>`; Next's `onRequestError` receives the request path; Rails request `Authorization` header on `/api/member/*`; `SendSmsJob` builds the magic link into a local `body` variable, which stack-frame variable capture would ship | Scrub `/s/<token>` to `/s/[token]` in URL, transaction name, breadcrumbs and message on both SDKs; deny-list `authorization` header; `data_collection.stack_frame_variables = false` on Rails; never `setUser` on member pages |
| Phone number (E.164) | Request params (`phone` on the household entry form); Twilio's own exception messages quote the `To` number verbatim; SQL breadcrumbs; job arguments | Rails `filter_parameters` already lists `phone` and sentry-rails 7 merges `filter_parameters` into its data-collection deny list; scrub the E.164 pattern in every string of every event on both SDKs; no `http_logger` breadcrumbs; job arguments stay integer ids (`config.active_job.log_arguments = false` exists for the same reason) |
| WorkOS access token (JWT) | Rails request `Authorization` header on `/api/*` | Header deny list |
| AuthKit session cookie (`wos-session`) | Next server request `cookie` header and `request.cookies` | `sendDefaultPii: false`, and `beforeSend` deletes `request.cookies` and the `cookie` header outright |
| Twilio auth token, account SID | Never in a request; the account SID is in outgoing Twilio URLs | No `http_logger` breadcrumbs; no `outgoing_request` bodies |
| Admin email and name | Sentry's default user context | `data_collection.user_info = false`; set the user by hand with the WorkOS user id only, and tag the household by group id; scrub the email pattern in every string of every event on both SDKs, for the address quoted as prose in a WorkOS or validation message |
| Twilio webhook signature | `X-Twilio-Signature` header | Header deny list |

Two rules follow from the table and hold for every phase:

- Never `sendDefaultPii` / `send_default_pii`. Sentry Ruby 7 deprecates the latter in
  favour of `data_collection`; we use `data_collection` and lock it down.
- A scrubber runs in `before_send` on both sides, and a unit test on both sides proves
  a token, a phone number and a bearer header do not survive it. A scrubber without
  the test is the same as no scrubber the day someone refactors it.

## 4. Architecture

Two Sentry projects in one organisation:

| Project | Platform | DSN lives in | Reports |
| --- | --- | --- | --- |
| `rota-api` | Ruby / Rails | Railway service variable `SENTRY_DSN` (runtime) | Puma requests, Active Job (Solid Queue), Solid Queue internals, recurring jobs, rake tasks, cron check-ins |
| `rota-web` | JavaScript / Next.js | `NEXT_PUBLIC_SENTRY_DSN` (build and runtime, see §5) | Server Components, Route Handlers, Server Actions, `proxy.ts`, the browser |

Environment and release are the same string on both sides so one deploy can be read as
one deploy:

- `environment`: `SENTRY_ENVIRONMENT` if set, else `production` on the production
  service. If Railway PR environments are ever enabled, set `SENTRY_ENVIRONMENT=preview`
  there; both SDKs are configured to send only for `production` and `preview`.
- `release`: `RAILWAY_GIT_COMMIT_SHA`, which Railway injects into every build and
  runtime. The web build uploads source maps under that release name, so the runtime
  must see the same variable, which on Railway it does.

Event flow, in one picture:

```
browser error ──► instrumentation-client.ts ──► POST /monitoring (tunnel) ──► rota-web
RSC / route / action / proxy error ──► onRequestError ──► sentry.server.config.ts ──► rota-web
Rails request error ──► Sentry::Rails::CaptureExceptions ──────────────────────► rota-api
Rails.error.report(...)  ──► Sentry::Rails::ErrorSubscriber ────────────────────► rota-api
Active Job failure  ──► sentry-rails ActiveJob reporter ────────────────────────► rota-api
Solid Queue thread error ──► SolidQueue.on_thread_error ──► Rails.error.report ─► rota-api
ReminderSweepJob / TopUpShiftWindowsJob ──► cron check-ins ─────────────────────► rota-api
```

## 5. Configuration reference

Add these to `.env.example`, all commented out, in a new `--- Sentry ---` section
written in the file's existing voice (say what breaks when it is wrong).

| Variable | App | When | Notes |
| --- | --- | --- | --- |
| `SENTRY_DSN` | api | runtime | Required in production, refused at boot if missing (see §6.2). Absent in development and test, which disables the SDK. |
| `NEXT_PUBLIC_SENTRY_DSN` | web | build and runtime | The first of the two `NEXT_PUBLIC_` variables in this repo. `next.config.ts` deliberately exports nothing through Next's `env` key so no secret is inlined into the browser bundle; a DSN is not a secret (it is a public, write-only address, rate-limited by Sentry and reached through our own tunnel route), so it is the one value that is allowed to be inlined. Document that sentence next to it in `.env.example` and `apps/web/README.md`, because the rule "nothing is `NEXT_PUBLIC_`" is otherwise going to look violated. Must be present at build time on Railway, since Next inlines it then. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | web | build only | The second and last `NEXT_PUBLIC_` variable, and an environment name rather than a credential. The browser cannot read `SENTRY_ENVIRONMENT`, so without this every deploy reports as `production` (that is what `NODE_ENV` is in any Railway build) and a preview deploy's browser events land in the production project's alert rules. Next inlines it at build time, so a runtime-only setting changes nothing. |
| `SENTRY_ENVIRONMENT` | both | runtime | Optional. Defaults to the Rails env / `NODE_ENV`. Only `production` and `preview` send. The browser half reads `NEXT_PUBLIC_SENTRY_ENVIRONMENT` instead, so a preview deploy sets both. |
| `SENTRY_RELEASE` | both | build and runtime | Optional override. Defaults to `RAILWAY_GIT_COMMIT_SHA`. |
| `SENTRY_AUTH_TOKEN` | web | build only | Source-map upload. Scopes: `project:releases`, `project:write`, `org:read`. Railway build variable, never a runtime one. Absent in CI and locally, which disables the upload and must not fail the build. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | web | build only | Which project the maps belong to. |
| `SENTRY_TRACES_SAMPLE_RATE` | both | runtime | Phase 4 only. Defaults to `0`. |

Nothing goes in `config/credentials.yml.enc`; the README's "one mechanism, one place to
look" rule stands.

## 6. Phase 1: Rails API

### 6.1 Gems

```ruby
# Gemfile
# Error reporting. `Rails.error.report` already has callers in the jobs; this is what makes
# them reach somebody. Configured in config/initializers/sentry.rb.
gem "sentry-ruby", "~> 7.0"
gem "sentry-rails", "~> 7.0"
```

Puma's low-level error hook is patched automatically by `sentry-ruby` when Puma is
loaded, so a request that dies before Rack (a parser failure) is still reported.
Thruster sits in front of Puma and needs nothing.

### 6.2 Boot policy: production refuses to run unreported

Mirror `SmsBoot` in `config/initializers/sms.rb`, for the same reason the SMS path gets
it: a misconfigured error reporter fails silently, and a silent error reporter is the
"dashboards stay green" failure again.

```ruby
# config/initializers/sentry.rb
module SentryBoot
  module_function

  # Production without a DSN is refused at boot. An app that runs unreported is one whose
  # first symptom of a broken sweep is a house that stopped being texted. Everywhere else
  # a missing DSN simply disables the SDK: development never sends, test never sends.
  def dsn_for(env:, value:)
    return value if value.present?
    return nil unless env.production?

    raise "SENTRY_DSN must be set in production. An unreported exception is a silent one."
  end
end
```

### 6.3 The initializer

```ruby
Sentry.init do |config|
  config.dsn = SentryBoot.dsn_for(env: Rails.env, value: ENV["SENTRY_DSN"])
  config.environment = ENV["SENTRY_ENVIRONMENT"].presence || Rails.env
  config.release = ENV["SENTRY_RELEASE"].presence || ENV["RAILWAY_GIT_COMMIT_SHA"].presence

  # Only these environments ever send. Development stays silent even with a DSN pasted
  # into .env; set SENTRY_ENVIRONMENT=preview locally to exercise the wire on purpose.
  config.enabled_environments = %w[production preview]

  # The point of the whole exercise: Rails.error.report gets a subscriber. Every existing
  # call in the jobs, and Solid Queue's on_thread_error, starts producing events.
  config.rails.register_error_subscriber = true

  # Transient Twilio failures retry with backoff on purpose (SendSmsJob). Reporting each
  # attempt would page five times for one wobble; exhaustion is reported by hand instead.
  config.rails.active_job_report_on_retry_error = false

  # Errors only, in phase 1. Tracing is a later decision, and it costs quota.
  config.traces_sample_rate = ENV.fetch("SENTRY_TRACES_SAMPLE_RATE", "0").to_f

  # --- What may be collected. Everything a member's token or number could ride in is off.
  dc = config.data_collection
  dc.user_info = false                      # we set the user by hand, id only (see 6.4)
  dc.cookies.mode = :off
  dc.http_headers.request.mode = :deny_list
  dc.http_headers.request.terms = %w[authorization cookie x-twilio-signature]
  dc.http_bodies = []                       # no request or response bodies, ever
  dc.url_query_params.mode = :off
  dc.database_query_data = false
  dc.stack_frame_variables = false          # SendSmsJob holds the rendered magic link in a local
  dc.frame_context_lines = 3

  # Breadcrumbs from Rails' own instrumentation, not from outgoing HTTP: the Twilio client
  # URLs carry the account SID, and there is nothing in them the SMS log does not already say.
  config.breadcrumbs_logger = [ :active_support_logger ]
  config.max_breadcrumbs = 30

  # Last line of defence. The scrubber is a plain object under app/lib so it has a spec.
  config.before_send = ->(event, _hint) { SentryScrubber.call(event) }

end

# Every event from this process says which app it came from. Child scopes inherit it.
Sentry.configure_scope { |scope| scope.set_tags(app: "api") }
```

Notes on what the defaults already do, verified in the gem source:

- `sentry-rails` 7 merges `Rails.application.config.filter_parameters` into the
  query-string deny list, and only when that collection is in deny-list mode. We switch
  query strings and bodies off outright, so the merge never applies: stricter than a
  filter, because a filter only redacts the keys somebody remembered to name.
- The request interface reads `action_dispatch.request_id`, so every event carries the
  same request id the STDOUT log line is tagged with. No extra code.
- `ActiveRecord::RecordNotFound`, `ActionController::ParameterMissing`,
  `ActionController::TooManyRequests` and friends are in sentry-rails' ignore list.
  They are all rescued in our controllers anyway (`TenantScoped`, `ApiErrorRendering`)
  and never reach the middleware. `TenantScoped::NoTenant` is not rescued and is a 500,
  which is correct: it is a bug in our code and should page.
- `rails.report_rescued_exceptions` stays `true`: exceptions that
  `ActionDispatch::ShowExceptions` turns into a 500 page are the ones we want.

### 6.4 Context on every event

Add one `before_action` to `Api::BaseController` (after `authenticate!`) and one to
`Api::MemberBaseController`:

```ruby
# Api::BaseController
def tag_sentry_scope
  Sentry.set_user(id: Current.user.workos_user_id)            # WorkOS user id, never email
  Sentry.set_tags(group_id: Current.group.id, surface: "admin")
end

# Api::MemberBaseController: no user. A member has no identity we want in Sentry.
def tag_sentry_scope
  Sentry.set_tags(group_id: current_member.group_id, member_id: current_member.id, surface: "member")
end
```

Both are `Sentry.` calls that no-op when the SDK is disabled, so development and test
need nothing. `member_id` is an integer row id, not the token.

### 6.5 The three gaps that need code

1. **`SendSmsJob` retry exhaustion and catch-all.** In the `retry_on` block, after
   `record_failure`, add
   `Rails.error.report(error, handled: true, severity: :warning, context: { sms_message_id: job.arguments.first, error_code: error.error_code }, source: "rotamonster.sms")`.
   In the `rescue StandardError` catch-all, add
   `Rails.error.report(e, handled: true, severity: :error, context: { sms_message_id: }, source: "rotamonster.sms")`.
   Keep both log lines. The house rule from the job comments applies: log and report,
   never one or the other.
2. **Invalid template at send time.** In the `Sms::PermanentFailure` branch, when
   `e.error_code == SmsMessage::INVALID_TEMPLATE`, report at `:warning` with source
   `rotamonster.sms.template`. The model validation should have caught it at save; reaching
   send time means the validation has a hole, which is worth knowing about.
3. **WorkOS key-set outage.** In `Authenticatable#authenticate!`'s
   `KeySetUnavailable` rescue, add
   `Rails.error.report(e, handled: true, severity: :warning, source: "rotamonster.workos")`.
   During an outage this fires once per request; Sentry groups them into one issue, and
   the per-project rate limit in §8 bounds the quota cost. Do not throttle it in code.

`HouseholdEntry.request_link` needs nothing: it enqueues with no rescue, so an enqueue
failure propagates as a 500 and is reported unhandled by the request middleware, which
is the right severity for it.

Nothing changes in `ReminderSweepJob`, `TopUpShiftWindowsJob` or Solid Queue: their
existing `Rails.error.report` calls are what the subscriber lights up. Update the
"no subscribers yet" comments in both jobs and both specs to say the subscriber exists
and why the log line stays.

### 6.6 Cron monitors for the recurring jobs

`config/recurring.yml` runs `reminder_sweep` every hour and `top_up_shift_windows`
daily at 03:00 UTC. A monitor answers the question the per-rota rescue cannot: did the
sweep run at all this hour? A worker that is down produces no exception and no event;
it produces a missed check-in.

```ruby
class ReminderSweepJob < ApplicationJob
  include Sentry::Cron::MonitorCheckIns
  sentry_monitor_check_ins slug: "reminder-sweep",
    monitor_config: Sentry::Cron::MonitorConfig.from_interval(1, :hour, checkin_margin: 15, max_runtime: 30, timezone: "UTC")
end

class TopUpShiftWindowsJob < ApplicationJob
  include Sentry::Cron::MonitorCheckIns
  sentry_monitor_check_ins slug: "top-up-shift-windows",
    monitor_config: Sentry::Cron::MonitorConfig.from_crontab("0 3 * * *", checkin_margin: 60, max_runtime: 60, timezone: "UTC")
end
```

Main has since added two more recurring jobs, and they get the same treatment for the
same reason: `sync-house-calendars` (crontab monitor on `27 * * * *`, 15-minute margin,
because an interval monitor would expect the next check-in an hour after the last one it
saw rather than at the minute the job actually runs) and `backfill-sms-prices` (daily
04:40 UTC, crontab monitor, hour margin). The price
backfill is silent by design when it has nothing to do, so a missed check-in is the
only signal it has stopped.

The mixin wraps `perform`: `in_progress` before, `ok` after, `error` if `perform` raises.
Because both jobs rescue per rota and carry on, a single broken rota still checks in
`ok`, which is right: that rota's failure is its own event, and the monitor's job is to
notice the whole sweep not happening. `capture_check_in` is a no-op when the SDK is
disabled, so the specs are unaffected. The monitors are created by the first check-in
(upsert), so there is nothing to click in the UI.

### 6.7 The scrubber

`app/lib/sentry_scrubber.rb`, a module with one public method `call(event)` returning
the event. It walks `event.to_hash`-shaped data and rewrites strings in place:

- E.164 numbers `\+[1-9]\d{6,14}` → `[phone]`. Twilio's `RestError` messages quote the
  `To` number; this is the row that catches it.
- Magic links `/s/[A-Za-z0-9_-]{20,}` → `/s/[token]`.
- `Bearer <anything>` → `Bearer [filtered]`, stopping at the first whitespace, quote,
  comma or semicolon so a header quoted inside JSON keeps everything after it.
- Email addresses `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` → `[email]`. An
  admin's address names the person the way the number names a housemate, and WorkOS and
  validation messages quote it back as prose.
- 32-byte URL-safe tokens standing alone (`\b[A-Za-z0-9_-]{43}\b`) → `[token]`. This
  is the shape `Member#access_token` has; a bare token in a log-derived breadcrumb is
  the case the first two rules miss.

Apply to: exception values and their messages, `message`, `transaction`, `request.url`,
`request.headers` (as a belt-and-braces on top of the deny list), every breadcrumb's
`message` and `data`, `extra`, `contexts` (including `rails.error`, which is where the
`context:` hash from `Rails.error.report` lands), `tags` values. Return the event.

### 6.8 Specs

All under the existing rules: WebMock blocks the network, `Sentry::TestHelper`'s
`DummyTransport` never opens a socket, and `bin/ci` must pass with no `SENTRY_DSN`.

- `spec/initializers/sentry_boot_spec.rb`: production with no DSN raises with the
  message above; development and test with no DSN return `nil`; any env with a DSN
  returns it. Same shape as `spec/initializers/sms_boot_spec.rb`.
- `spec/lib/sentry_scrubber_spec.rb`: an event whose message, exception value, request
  URL, breadcrumb data, `rails.error` context and extra each contain a phone number, a
  magic link, a bearer header and a bare token comes out with none of them. Assert on
  the serialised JSON of the whole event containing none of the five fixtures, so a new
  field the walker misses fails the spec rather than leaking.
- `spec/sentry/error_reporter_spec.rb`: `setup_sentry_test` in a `before`,
  `teardown_sentry_test` in an `after`. `Rails.error.report(boom, context: { rota_id: 1 }, source: "rotamonster.reminder_sweep")`
  yields exactly one event in `sentry_events`, tagged `source` and `handled: true`,
  with `contexts["rails.error"]["rota_id"] == 1`. This is the test that proves the
  subscriber is registered; without it, `register_error_subscriber` is a config line
  somebody can delete.
- `spec/requests/sentry_request_privacy_spec.rb`: a request to a member route with a
  bearer token and a phone in the body that raises (stub a controller to `raise`)
  yields an event whose serialised JSON contains neither. Also assert
  `request.headers` has no `Authorization` and no `Cookie`.
- `spec/jobs/send_sms_job_spec.rb`: retry exhaustion reports once with source
  `rotamonster.sms` and the message id; the catch-all reports once; a transient failure
  that later succeeds reports nothing.
- `spec/jobs/reminder_sweep_job_spec.rb` and `top_up_shift_windows_job_spec.rb`:
  replace the "no subscribers yet" comments; keep the `Rails.error.report` and log
  assertions as they are.
- Cron: `ReminderSweepJob.sentry_monitor_slug == "reminder-sweep"` and the monitor
  config's schedule is hourly; same for the daily job. Cheap, and it stops a rename
  from silently orphaning the monitor.

### 6.9 Smoke, on the real service

`lib/tasks/sentry.rake`:

```ruby
namespace :sentry do
  desc "Send one message and one exception to Sentry, tagged with this release"
  task smoke: :environment do
    release = Sentry.configuration.release   # read before close: configuration is nil afterwards
    Sentry.capture_message("sentry:smoke #{release}", level: :info)
    Rails.error.report(RuntimeError.new("sentry:smoke exception"), handled: true, source: "rotamonster.smoke")
    Sentry.close   # drain the background worker before the process exits
    puts "sent; check rota-api for two events under release #{release}"
  end
end
```

Run `bin/rails sentry:smoke` on the Railway API service after the first deploy. Two
events, release equal to the commit SHA, environment `production`, tag `app:api`.

## 7. Phase 2: Next.js web

### 7.1 Install

`npm install @sentry/nextjs@^10.74` in `apps/web`. Next 16 builds with Turbopack, and
under Turbopack the SDK refuses the old `sentry.client.config.ts` and requires
`instrumentation-client.ts` (the SDK's own build-time message says so). The file layout
below is the Turbopack-correct one.

### 7.2 Files

`next.config.ts`: keep everything that is there (the root `.env` loading is
deliberate and stays first), then wrap the export.

```ts
// The config subpath: the main-entry re-export is deprecated in SDK 10 and gone in 11.
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // CI and local builds have no token: the upload is skipped, the build must still pass.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Upload, then delete: .next/static must not serve our maps to the public.
    deleteSourcemapsAfterUpload: true,
  },
  release: { name: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA },
  // Browser events go to our own origin. Ad blockers block sentry.io by default, and
  // an admin running uBlock on a laptop is exactly our user.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  telemetry: false,
  silent: !process.env.CI,
});
```

`src/instrumentation.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

// Server Components, Route Handlers, Server Actions and proxy.ts all report through
// this one hook. Next 16 does not auto-instrument proxy.ts the way the SDK once wrapped
// middleware.ts; onRequestError is what covers it.
export const onRequestError = Sentry.captureRequestError;
```

`sentry.server.config.ts` (in `apps/web`, next to `next.config.ts`):

```ts
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubBreadcrumb } from "@/lib/observability/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  enabled: ["production", "preview"].includes(process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? ""),
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  initialScope: { tags: { app: "web" } },
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
```

`sentry.edge.config.ts`: the same three fields, no scrubbing imports beyond the shared
module. `proxy.ts` runs on the Node runtime in Next 16, so nothing of ours runs on the
edge today; the file exists because the SDK expects it and it costs nothing.

`src/instrumentation-client.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubBreadcrumb } from "@/lib/observability/scrub";

const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,
  // Development never sends, and only production and preview do, as on the server.
  enabled: ["production", "preview"].includes(environment ?? ""),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,     // decided against, see §2
  replaysOnErrorSampleRate: 0,
  initialScope: { tags: { app: "web", runtime: "browser" } },
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

The browser bundle can only see `NEXT_PUBLIC_` values. The release needs no variable of
its own: `withSentryConfig`'s `release.name` injects it at build. The environment does,
because `NODE_ENV` is `production` in every Railway build, preview included, so a
preview deploy's browser events would otherwise land in the production project's alert
rules. `NEXT_PUBLIC_SENTRY_ENVIRONMENT` is that variable, and it is the second and last
of its kind here; both reads name it in full, since Next inlines the literal text.

### 7.3 Error boundaries and the places that swallow

- `src/app/global-error.tsx`: new. It replaces the root layout when that layout throws,
  so it renders its own `<html>` and `<body>`, imports `globals.css` itself, and calls
  `Sentry.captureException(error)` in a `useEffect`. Copy in the Soft Clay voice
  ("That one is on us." is already the house line), no em dashes, semantic tokens only
  or the lint rule fails the build.
- `src/app/error.tsx`: replace `console.error(error)` with
  `Sentry.captureException(error)`; keep the digest note, since the digest is what
  joins the client event to the server one.
- `src/app/h/[slug]/error.tsx`: accept the `error` prop and capture it. It drops it
  today.
- `src/components/confirm-dialog.tsx`: the `catch` that keeps the dialog open should
  `Sentry.captureException(error)` instead of `console.error`. The caller still owns the
  toast.
- `src/lib/api/http.ts`: after `buildApiError`, if `response.status >= 500`, call
  `Sentry.captureException(error, { level: "error", tags: { api_code: error.code, api_status: String(response.status) }, fingerprint: ["rails-5xx", error.code] })`
  before throwing. Server actions convert `ApiError` into a returned body so the client
  can toast it, which means a Rails outage would otherwise be invisible from the web
  project. 4xx is never reported: it is the API doing its job.
- Server Actions themselves need no wrapping: anything they do not convert to a body is
  rethrown, and `onRequestError` reports it with `routeType: "action"`.

### 7.4 The tunnel and the proxy

`tunnelRoute: "/monitoring"` makes the browser POST events to our own origin, where the
SDK's route forwards them to Sentry. Every path not excluded by the matcher in
`src/proxy.ts` requires an AuthKit session, so a member's browser on `/s/<token>` would
have its error report redirected to WorkOS sign-in. Two edits, together:

1. Add `monitoring` to the matcher literal in `src/proxy.ts` (it must stay an inline
   literal; Next parses it statically).
2. Update `PROXY_MATCHER` in `src/lib/auth/proxy-matcher.ts` and its test, which
   asserts the literal and the constant stay in sync. Add an assertion that
   `/monitoring` is excluded, beside the existing ones for `/s/` and `/callback`.

Do not add `/monitoring` to `unauthenticatedPaths` instead; that still runs the session
refresh over every event POST for no reason.

### 7.5 The scrubber, shared by both runtimes

`src/lib/observability/scrub.ts`. No `server-only` (the browser needs it), no secrets,
no `sonner`. Exports `scrubString`, `scrubEvent(event)` and
`scrubBreadcrumb(breadcrumb)` and applies the same five rewrites as the Rails
scrubber (E.164, `/s/<token>`, `Bearer …`, email address, bare 43-char token) to: `message`,
`transaction`, `request.url`, every exception value, every breadcrumb's `message`,
`data.url`, `data.from`, `data.to`, `extra`, `contexts`, and tag values. It also
deletes `request.cookies` and the `cookie` and `authorization` request headers
outright.

`src/lib/observability/scrub.test.ts` in vitest: same fixtures as the Rails spec, same
"the serialised event contains none of them" assertion. Add the fixture strings as
constants shared by both tests? No: two languages, two files, the same five literals
copied. A comment in each names the other.

### 7.6 Context

In `src/app/(admin)/layout.tsx`, after `requireHousehold()`:
`Sentry.setUser({ id: user.id }); Sentry.setTag("household", organizationId)`. The
Node SDK scopes this to the request. Nothing on the member layout or the household
entry page: those users have no identity we want to record.

### 7.7 Bundle safety and CI

`npm run ci` runs lint, typecheck, vitest, the token gate, `next build` and
`check:bundle`, with no `.env` and no Sentry variables:

- Build: `sourcemaps.disable` is true without a token, `silent` is on, the build passes.
  Verify this once locally with `env -i PATH=$PATH npm run ci` before opening the PR.
- `scripts/assert-token-not-in-bundle.mjs` greps client chunks for `/api/member/` and
  the `API_URL` sentinel. The Sentry client chunk contains neither; the DSN and
  `/monitoring` are expected. Run it and read the output, do not assume.
- `src/lib/api/bundle-safety.test.ts` scans Client Components for imports of the
  server-only modules. `error.tsx` and `global-error.tsx` import `@sentry/nextjs`
  only, so nothing changes; the test keeps proving it.
- `instrumentation-client.ts` is a browser entry point. It imports nothing but
  `@sentry/nextjs` and the scrub module, and the scrub module has no `server-only`
  guard on purpose. Add `lib/observability/scrub` to nothing in `SERVER_ONLY_MODULES`;
  it is meant to be in the browser.
- Lint: the new `.tsx` files fall under the raw-colour rule. `global-error.tsx` uses
  tokens like every other screen.

### 7.8 Source maps on Railway

Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` as build-time variables on
the web service. `RAILWAY_GIT_COMMIT_SHA` is present at build and runtime, so the
release the maps are uploaded under is the release the runtime reports. After the first
deploy, open a browser event and confirm the stack frames show TypeScript source, not
minified chunks. If they do not, the release strings differ; compare the event's
`release` with the artefact bundle in Sentry's Releases page.

### 7.9 Smoke

Add `src/app/debug/sentry-smoke/page.tsx`, a Server Component that throws
`new Error("sentry smoke: web")` during render, with `export const dynamic = "force-dynamic"`
so `next build` does not prerender it and hit the throw. It sits under the proxy matcher,
so it needs an admin session: that is the guard. One visit while signed in produces two
events: the server one through `onRequestError`, and the browser one when `error.tsx`
catches the same failure and reports it through `/monitoring`. The two share the
digest. Delete the page in the same PR series once both events are seen; do not leave a
throw-on-demand page in production, even behind login.

## 8. Phase 3: Alerts, monitors, ownership

Sentry without alert rules is a log with a nicer UI. Configure, per project:

| Rule | Condition | Action |
| --- | --- | --- |
| New issue | first seen, environment `production` | email + Slack `#rota-alerts` immediately |
| SMS path | any event with tag `source` in `rotamonster.sms`, `rotamonster.sms.template`, `rotamonster.reminder_sweep`, `rotamonster.shift_generation` | Slack immediately, high priority; never auto-resolve |
| Regression | a resolved issue reappears | Slack |
| Storm | an issue seen more than 50 times in 10 minutes | Slack, and it is a signal to look at the rate limit below |
| WorkOS outage | tag `source:rotamonster.workos` | Slack once per hour, not per event |

Cron monitor alerts (api project): a missed check-in or a check-in in `error` on
`reminder-sweep`, `top-up-shift-windows`, `sync-house-calendars` or
`backfill-sms-prices` alerts the same channel. Set the monitor's
"failure issue threshold" to 1 and the recovery threshold to 1. A missed hourly sweep is
a late text, not a lost one (the sweep is a reconciliation loop), so the margin of
15 minutes is generous enough to survive a deploy and tight enough to catch a dead
worker before the next send hour.

Uptime (optional, cheap): a Sentry uptime monitor on `${API_URL}/up` and on
`${APP_URL}/`. `/up` is already excluded from the SSL redirect and from log noise.

Quota and rate limits: errors are sampled at 1.0. Turn on spike protection on both
projects and set a per-project rate limit of 100 events per minute. The WorkOS outage
path is the one that can storm (one event per request for the duration), and the rate
limit is what keeps a ten-minute outage from spending the month's quota.

Ownership: one person is on the hook for the alert channel, and until the volume is
known that person opens Sentry each morning. Rules for triage:

- Every production issue is resolved, assigned, or ignored within a day.
- "Ignore" only with a written fingerprint rule or a reason in the issue, never as a
  way to make the inbox smaller.
- The SMS sources are never muted. If one is noisy, the noise is a bug.

## 9. Phase 4: later, and only after the error side is trusted

- **Tracing.** Set `SENTRY_TRACES_SAMPLE_RATE=0.1` on both services and
  `tracePropagationTargets: [process.env.API_URL]` on the Node SDK so a server action's
  `fetch` to Rails carries `sentry-trace` and `baggage`. sentry-rails reads them, and
  `active_job_propagate_traces` (default on) carries the trace into the job. An admin
  click, the action, the Rails request and the enqueued `SendSmsJob` become one trace.
  Worth it for "why is the shifts page slow", not needed for "why did Alice not get a
  text".
- **Sentry Logs.** `config.structured_logging.enabled = true` on Rails ships the
  existing STDOUT lines. The log lines are already scrubbed by design (job arguments
  off, tokens never in paths) and the scrubber in §6.7 runs on log events too. Only if
  Railway's log search proves insufficient.
- **Release health** on the web project: sessions are cheap and answer "did this
  deploy make things worse". Enable once tracing is on.

## 10. Definition of done

Go-live checklist, in the order it can actually be done:

- [ ] Sentry organisation with projects `rota-api` and `rota-web`; DSNs and the
      web auth token set on Railway (api: runtime `SENTRY_DSN`; web: build and runtime
      `NEXT_PUBLIC_SENTRY_DSN`, build-only `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
      `SENTRY_PROJECT`).
- [ ] `.env.example` documents every variable in §5, with the `NEXT_PUBLIC_` exception
      explained in place.
- [ ] `bin/ci` green with no Sentry variables; `npm run ci` green with no Sentry
      variables (build succeeds, source-map upload skipped, `check:bundle` passes).
- [ ] Production API boot refuses without `SENTRY_DSN`; verified once on purpose by
      deploying without it and reading the crash log, then setting it.
- [ ] `bin/rails sentry:smoke` on Railway produced two events with release equal to
      the deploy SHA, environment `production`, tag `app:api`, and the request-free
      context expected of a rake task.
- [ ] Web smoke route produced one server event and one browser event; the browser
      event arrived via `/monitoring`; both are symbolicated to TypeScript source.
- [ ] Privacy audit on the first 24 hours of real events: search both projects for
      `+44`, `+1`, `/s/`, `Bearer`, `wos-session`, `@`. Expect zero hits. Record the
      search in the verification section of this document when it is done.
- [ ] All four cron monitors show a green check-in history covering at least one full day.
- [ ] The alert rules in §8 exist and the smoke event reached the channel.
- [ ] The smoke route is deleted.
- [ ] The "no subscribers yet" comments in the two jobs and their specs are gone.
- [ ] `apps/web/README.md` and the root README mention Sentry where they mention the
      other services, and link here.

## 11. Suggested pull requests

Four PRs, each independently deployable, each with its own verification section
appended to this document in the style of `household-entry.md`:

1. **api: Sentry SDK, boot policy, scrubber, specs.** Gems, `config/initializers/sentry.rb`,
   `app/lib/sentry_scrubber.rb`, the four specs in §6.8 that do not touch jobs, `.env.example`.
   Ships with `register_error_subscriber = true`, so the existing job reports go live
   the moment `SENTRY_DSN` is set.
2. **api: the three gaps and the cron monitors.** `SendSmsJob`, `Authenticatable`, the
   invalid-template report, the two `include Sentry::Cron::MonitorCheckIns`, the
   context tags on the two base controllers, updated job specs, the smoke rake task.
3. **web: Sentry SDK, boundaries, tunnel, scrubber.** Everything in §7 including the
   proxy matcher change and its test, the CI proof, and the temporary smoke route.
4. **ops: alerts, monitors, verification.** Sentry-side configuration (documented here,
   since it lives outside the repo), the privacy audit, the smoke route removal, the
   README links, and the verification section.

## 12. Open questions

- **Railway PR environments.** If they are enabled, `SENTRY_ENVIRONMENT=preview` on
  both services keeps preview noise out of production alerts. The SDK config already
  allows `preview`; the alert rules in §8 are scoped to `production`.
- **Where the alerts go.** Slack is assumed. If there is no workspace, email is the
  fallback and the "once per hour" rule for the WorkOS outage becomes important.
- **Admin identity in events.** This plan records the WorkOS user id only. If
  debugging turns out to need the email, that is a `data_collection.user_info`
  decision to make explicitly, not a default to inherit.

## Verification (2026-09-13)

Phases 1 and 2 are implemented on branch `claude/sentry-production-error-logging-y0zrga`
as two commits, one per app, with the plan's PR slices 1 to 3 folded into them. Gates
run on Ruby 3.4.5 (the version the project pins), Node 22 and Postgres 16, with no
`.env` and no Sentry variables set:

- API: 1290 examples pass, RuboCop clean, Brakeman 0 warnings, gem audit clean.
  Production boot without `SENTRY_DSN` raises the boot message; with a DSN it boots and
  every cron monitor config resolves.
- Web: 383 vitest tests across 35 files pass, lint and typecheck clean, 42 semantic tokens
  in both themes, production build succeeds with the source-map upload skipped, and the
  client-chunk token gate passes. A build with `RAILWAY_GIT_COMMIT_SHA` set carries that
  release string in a client chunk and leaves no `.map` files in `.next/static`.
- Privacy: on both sides a serialised event carrying a phone number, a magic link, a
  bearer header and a bare token contains none of them after scrubbing. On the API this
  is also proved on a real member request that raises: no token, no phone, no body,
  headers redacted, no user set.

Deviations from the plan as first written, all folded back into the sections above:
the admin user id is the WorkOS id from `Current.user`; the smoke rake task reads the
release before closing the SDK; frames' context lines are scrubbed because the spec
caught a phone literal surviving there; the web config helper is imported from the SDK's
`config` subpath; the browser SDK is gated to production builds; the smoke page is
`force-dynamic`. The bare-token rule uses lookarounds on both sides because `\b` does
not match at a `-` or `_` edge, which a URL-safe token has about one time in thirty.

Merged with main on 2026-09-13 after the pull request opened. Main had renamed the
error source prefix to `rotamonster.`, added two recurring jobs and a super admin
route group; the new sources follow the rename, both jobs carry cron monitors, and the
super admin layout tags its events with the operator's WorkOS user id and its own
surface. Every gate was re-run after the merge and stayed clean.

Rebased onto main 2026-09-14 as one commit; gates re-run: rubocop clean, 1290 API
examples, 383 web tests, lint, tsc and production build green.

Still to do, all outside the repo: create the two Sentry projects and set the variables
on Railway (section 5), run `bin/rails sentry:smoke` and visit the web smoke page, the
alert rules and monitor thresholds (section 8), the 24-hour privacy audit, and then
delete `apps/web/src/app/debug/`. Section 10 is the checklist.
