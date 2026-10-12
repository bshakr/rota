# Rota Monster production moves off Railway onto the Mac mini, behind a Cloudflare Tunnel

- Status: accepted
- Date: 2026-10-12
- Research: [hosting cost research report](https://claude.ai/artifact/L6HWjGBz7Pzs1vRxos9YWh)
- Followed by: [ADR 0003, rewrite the API in Go with SQLite](0003-rewrite-the-api-in-go-with-sqlite-and-serve-a-static-web-build.md)

## Context

Production runs on Railway as three services: `api`, `web` and Postgres. Measured usage from 5 to 12 October 2026 was 1.02 GB average memory for the api, 0.30 GB for web and 0.12 GB for Postgres, with CPU near zero. At list price that is about $14.50 a month, roughly £130 a year, for a product with a handful of houses. The budget for hosting is £10 to 15 a year, all in.

Most of the api's memory is Solid Queue, not Rails. `apps/api/config/puma.rb:38` loads `plugin :solid_queue` when `SOLID_QUEUE_IN_PUMA` is set, and in its default fork mode the plugin forks a supervisor, a dispatcher, a worker and a scheduler, each a full copy of the app. `apps/api/Dockerfile:27-32` preloads jemalloc, but Railway may be building with Railpack rather than that Dockerfile, so jemalloc is probably not active. That is unconfirmed: the service's build log or root-directory setting would say.

Bass owns a Mac mini that is already on and on his desk all day, running OpenClaw, an always-on AI agent. Its marginal cost is electricity.

## Decision

- Production runs on the Mac mini with native runtimes: Homebrew Postgres, Ruby 3.4.5 and Node, each started at boot by a LaunchDaemon under a dedicated standard user `rota`. Not Docker Desktop (about 1.8 GB idle and needs a logged-in session), not OrbStack (the free licence is personal use only), not Colima (a LaunchAgent, so it needs a login).
- A boot-time Cloudflare Tunnel (`sudo cloudflared service install`) publishes two hostnames: `rota.monster` to web on `localhost:3001` (`apps/web/package.json`, `next start -p 3001`) and `api.rota.monster` to the api on `localhost:3000` (`puma.rb`, `PORT` default). The api must stay public because Twilio posts delivery receipts to `API_URL` (`apps/api/app/models/sms.rb:63`, `config/initializers/sms.rb:79`). `api.rota.monster` does not exist yet; it is created as part of this move. TLS ends at Cloudflare; `config.assume_ssl` is already on (`config/environments/production.rb:22`), so `force_ssl` does not loop.
- Postgres holds the three production databases `database.yml` already names (primary, `_cache`, `_queue`), reached over the local socket with `HOUSEROTA_API_DATABASE_PASSWORD`, so no `*_DATABASE_URL` is set.
- Secrets live in a root-owned `0600` env file read by the LaunchDaemon wrapper. The app has no `credentials.yml.enc`, so every secret is an env var.
- Deploys are pull, not push: a script runs every 5 minutes, and when `main` has moved and CI on that commit is green it pulls, installs, migrates, builds web and restarts. There is no self-hosted GitHub runner: the repo is public, so a fork's pull request could run code on the mini. The Docker entrypoint's `db:prepare` no longer runs, so the script migrates itself.
- A nightly `pg_dump` of the primary database, encrypted, goes to Cloudflare R2 (free under 10 GB) with a 30-day lifecycle rule.
- Monitoring is a Healthchecks.io heartbeat from the mini plus the existing Sentry reminder-sweep monitor.
- The mini runs `pmset autorestart 1` with sleep off. macOS updates are applied by hand.
- Two code changes land before cutover:
  1. Solid Queue runs inside the Puma process. Solid Queue 1.4.0 offers `solid_queue_mode :async` next to the plugin line (`lib/puma/plugin/solid_queue.rb:5` in the gem), which runs the workers, dispatcher and scheduler as threads. Jemalloc and `MALLOC_ARENA_MAX=2` are set in the LaunchDaemon environment.
  2. `SendSmsJob`'s transient retry window grows from about 6 minutes to about 2 hours. Today it is `attempts: 5` with `:polynomially_longer` (`apps/api/app/jobs/send_sms_job.rb:20`), waits of 3, 18, 83 and 258 seconds. After the last attempt the row is `failed`, and the sweep skips any shift and reminder that already has a row, whatever its status (`apps/api/app/services/reminder_sweep.rb:83-90`, `:48`). So a home internet blip during the top-of-hour send loses that text for good. `attempts: 9` on the same backoff waits about 2.4 hours.

Missed sweeps still catch up on their own. The sweep runs hourly and texts anything due and unclaimed within the last 24 hours (`STALE_AFTER`, `reminder_sweep.rb:25`, `:95-97`). The day-of reminder is the exception: it is dropped once the shift's day is over in the group's time zone (`reminder_sweep.rb:9-13`, `:50`), so an outage that lasts past midnight loses it.

## Consequences

- Easier: hosting falls to about £10 to 15 a year: the .monster renewal at about $10.20 a year at Cloudflare (paid to 2027-09-12) and £2 to 7 of electricity. Tunnel, R2 and Healthchecks are free. `FIXED_MONTHLY_COST_GBP` on the spend page drops to about £1.
- Harder: availability is now Bass's home power and broadband. A long outage delays texts, and one past midnight loses that day's day-of reminders. There is no managed Postgres, no one-click rollback and no preview deploys. `next build` now runs on the mini and is a memory spike of its own. Async Solid Queue is not the gem's recommended mode: a job that hangs or leaks shares the web process.
- We owe these before cutover:
  - **OpenClaw's user.** Bass does not know if OpenClaw runs as an admin user. The first setup step checks it. If it is admin, move OpenClaw to a standard user, or accept that a compromised OpenClaw can read housemates' phone numbers and the Twilio, WorkOS and Anthropic keys.
  - **FileVault.** Unknown. If it is on, the mini stops at the unlock screen after a power cut until someone unlocks it; macOS 26 allows that over SSH.
  - **Cutover.** Run both in parallel, restore an R2 backup onto the mini once, then switch DNS. Keep Railway's api up until receipts for texts sent before the switch have arrived, because each text carries the old callback URL. The Railway workspace is shared with other projects, so only Rota's services are removed and only their cost is saved.
  - **Env vars to carry over** (names only). api: `SECRET_KEY_BASE`, `APP_URL`, `API_URL` (now `https://api.rota.monster`), `CORS_ORIGINS`, `HOUSEROTA_API_DATABASE_PASSWORD`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_JWT_ISSUER`, `SUPER_ADMIN_WORKOS_USER_IDS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `DEFAULT_PHONE_COUNTRY`, `SIGNUP_ALERT_PHONE`, `ANTHROPIC_API_KEY`, `ANALYTICS_SHARED_SECRET`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SPEND_GBP_PER_USD`, `FIXED_MONTHLY_COST_GBP`, `SMS_ESTIMATED_SEGMENT_COST_GBP`, `SOLID_QUEUE_IN_PUMA`, `RAILS_MAX_THREADS`, `JOB_CONCURRENCY`, `RAILS_LOG_LEVEL`. web runtime: `API_URL`, `APP_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`, `SUPER_ADMIN_WORKOS_USER_IDS`, `ANALYTICS_SHARED_SECRET`, `SENTRY_ENVIRONMENT`. web build: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. `RAILWAY_GIT_COMMIT_SHA` disappears, so the deploy script sets `SENTRY_RELEASE` to the commit for both apps and for the web build.
  - **The Go and SQLite rewrite** ([ADR 0003](0003-rewrite-the-api-in-go-with-sqlite-and-serve-a-static-web-build.md)) is the second step, to cut memory on the mini further.

## Alternatives considered

- **Cloudflare Workers free plan with D1.** Lost because it is a TypeScript rewrite of 12 to 18 agent-days, under a 10 ms CPU limit, on a database without interactive transactions.
- **Oracle Cloud Always Free.** Lost because idle instances are reclaimed, and ours is idle almost all the time.
- **Cloud Run with Neon.** Lost because of cold starts, and the 1 GB free egress sits exactly at our traffic.
- **Northflank sandbox.** Lost because it is not meant for production.
- **Railway, tuned and sleeping.** Lost because it still costs about £35 to 60 a year.
- **The cheapest VPS.** Lost because it is about £24 a year with the domain, above budget.

## As built

Corrections from [BLO-2002](https://linear.app/bloombase/issue/BLO-2002) (`deploy/mini/`); the decision stands.

- The env files are owned by `root`, group `rota`, mode `0640`, not `0600`: the daemons run as `rota` and could not read a root-only file. They are split by reader (`env`, `api.env`, `web.env`, `build.env`, `deploy.env`, `backup.env`), and builds see none of the runtime secrets.
- On macOS, `MALLOC_ARENA_MAX` is glibc-only and does nothing; the api uses `MALLOC_CONF=narenas:2`. jemalloc is loaded by `rota-run.sh` exporting `DYLD_INSERT_LIBRARIES`, not by the plist, because SIP strips `DYLD_*` when `/bin/bash` starts.
- The deploy runs `bin/rails db:prepare`, not `db:migrate`: the cache and queue databases have schema files but no migrations, and only `db:prepare` creates and loads them.
- `TZ=UTC` and `RAILS_ENV=production` are set by the wrapper, not the env file.
- The tunnel ingress targets `127.0.0.1:3000` and `127.0.0.1:3001`, not `localhost`: api and web bind IPv4 loopback only, and `localhost` may resolve to `::1` first.
- The parallel run loads a `pg_dump` taken from Railway, since R2 holds only the mini's own backups, and runs dark: no jobs and Twilio test credentials. Cutover freezes Railway and restores a final dump before DNS moves.
