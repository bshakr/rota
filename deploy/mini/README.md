# Production on the Mac mini

How [ADR 0002](../../docs/adr/0002-host-rota-monster-on-the-mac-mini-behind-a-cloudflare-tunnel.md) runs: five LaunchDaemons under the standard user `rota`, a Cloudflare Tunnel in front, Healthchecks.io watching.

| Daemon | Runs | When |
| --- | --- | --- |
| `monster.rota.postgres` | Homebrew `postgresql@16` (CI's major), data in `/opt/rota/pgdata`, with `LC_ALL=C` as Homebrew's own service sets it: with no locale it exits with "postmaster became multithreaded during startup" | always |
| `monster.rota.api` | `rota-run.sh api`: Puma, `127.0.0.1:3000`, with Solid Queue inside once live (`SOLID_QUEUE_IN_PUMA=1`) | always |
| `monster.rota.web` | `rota-run.sh web`: `next start`, `127.0.0.1:3001` | always |
| `monster.rota.deploy` | `deploy.sh` | every 5 minutes |
| `monster.rota.backup` | `backup.sh` | 03:15 daily |

Layout: `/opt/rota/repo` (clone, fetch only), `/opt/rota/releases/<sha>` (one build per commit), `/opt/rota/current` (symlink the daemons start from), `/opt/rota/shared/bundle` (gems), `/opt/rota/log/<daemon>.log`.

## How it behaves

- **Locale**: launchd starts jobs with none, so the other four plists set `LANG=en_US.UTF-8`; without it Ruby reads files as US-ASCII until Rails loads, so `bundle install` and native gem builds can fail with "invalid byte sequence in US-ASCII".
- **Runtimes** come from mise: one tool for Ruby and Node, reading the `apps/api/.ruby-version` of the release being run. Node is 22, the version CI builds with. The wrapper execs the absolute install path, never a shim.
- **Deploy** fetches `origin/main` and deploys only its tip; there is no way to point the job at another ref. If the tip differs from `current/REVISION`, it asks the public GitHub API for the commit's check-runs and goes on only when `apps/api` and `apps/web` are both present, completed and successful. It then builds a fresh `releases/<sha>` (`bundle install`, `npm ci`, `npm run build` with `SENTRY_RELEASE=<sha>`), runs `bin/rails db:prepare`, swaps the `current` symlink and kickstarts api and web. It waits until launchd reports a new pid for both (launchd never runs two copies of a job, so from then on the old processes are gone), then needs exactly `200` from `127.0.0.1:3000/up` and `127.0.0.1:3001/`, and the pids must not change again while it checks. Anything else, including a failed kickstart, swaps back to the previous release and restarts it. Migrations are not rolled back, so they must stay compatible with the previous release. `DRY_RUN=1` does the fetch and the CI check for real and prints everything after.
- **Failures alert once.** A sha that fails to build, migrate, restart or pass the health check is written to `/opt/rota/state/failed`, its release directory is deleted, and `/fail` is pinged once. Later runs skip that sha until `main` moves; to retry it, `rm /opt/rota/state/failed /opt/rota/state/alerted`. Red CI pings `/fail` once per sha. Pending CI retries every run (exit 75), and pings `/fail` once if `main`'s tip is still pending after 6 hours (`PENDING_ALERT_HOURS`), which is what a `[skip ci]` commit or a run that never started looks like. Every run that is not deploying health-checks the running release and pings success, so the deploy check is also the mini's heartbeat. For the first 10 minutes after boot the health check waits up to 5 minutes instead of 90 seconds.
- **Rollback**: `sudo -u rota -H /bin/bash /opt/rota/current/deploy/mini/deploy.sh rollback <sha>` (from `current`, like the daemons: `/opt/rota/repo` is fetch-only and its working tree stays at the clone). The sha must be on `main` with green CI. It goes through the same build, health check and swap, and holds `main`'s current tip back (as if it had failed) so the 5-minute job does not put it straight back; the next commit on `main` deploys as usual.
- **Disk**: at most 3 releases (`KEEP_RELEASES`) stay: current, the previous one and the newest other. Failed candidates are deleted at once. `bundle clean` runs after a deploy only when every kept release locks the same gems, because the gem directory is shared and a rollback needs its gems.
- **jemalloc** is active for the api. The wrapper exports `DYLD_INSERT_LIBRARIES` itself because SIP strips `DYLD_*` whenever a protected binary such as `/bin/bash` or `/usr/bin/env` starts, so the variable cannot live in the plist. `MALLOC_ARENA_MAX` is a glibc setting and does nothing on macOS; `MALLOC_CONF=narenas:2` is the jemalloc equivalent. To confirm on the mini: `sudo -u rota -H /opt/rota/current/deploy/mini/rota-run.sh exec api /bin/bash -c 'DYLD_INSERT_LIBRARIES=/opt/homebrew/opt/jemalloc/lib/libjemalloc.2.dylib MALLOC_CONF=stats_print:true exec ruby -e 1' 2>&1 | head -2` prints `Begin jemalloc statistics`.
- **Logs**: launchd reopens `deploy.log` and `backup.log` on every run, so [`newsyslog-rota.conf`](newsyslog-rota.conf) rotates them (7 gzipped copies). api, web and postgres hold their logs open, and newsyslog has no copy-and-truncate, so each deploy run instead gzips any of those over 50 MB to `<name>.log.1.gz` and truncates it in place. Trim by hand with `: > file`, never `mv`.

## Secrets

`/usr/local/etc/rota/`, one file per reader, each owner `root`, group `rota`, mode `0640` (group `rota` is a dedicated group, so admin users in `staff` cannot read them). One `KEY=value` per line, no quotes, no `export`; values are read literally and never printed. [`env.example`](env.example) is the template with every name.

| File | Read by |
| --- | --- |
| `env` | api and web at runtime: `API_URL`, `APP_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `SUPER_ADMIN_WORKOS_USER_IDS`, `ANALYTICS_SHARED_SECRET`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` |
| `api.env` | api at runtime and `db:prepare`: `SECRET_KEY_BASE`, `CORS_ORIGINS`, `HOUSEROTA_API_DATABASE_PASSWORD`, `WORKOS_JWT_ISSUER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `DEFAULT_PHONE_COUNTRY`, `SIGNUP_ALERT_PHONE`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `SPEND_GBP_PER_USD`, `FIXED_MONTHLY_COST_GBP`, `SMS_ESTIMATED_SEGMENT_COST_GBP`, `SOLID_QUEUE_IN_PUMA`, `RAILS_MAX_THREADS`, `JOB_CONCURRENCY`, `RAILS_LOG_LEVEL`, `ROTA_MODE` |
| `web.env` | web at runtime: `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`, and `API_URL=http://127.0.0.1:3000`, which skips the trip out through Cloudflare |
| `build.env` | `next build` only: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| `deploy.env` | `deploy.sh`: `HEALTHCHECKS_DEPLOY_URL` |
| `backup.env` | `backup.sh`: `HEALTHCHECKS_BACKUP_URL`, `HOUSEROTA_API_DATABASE_PASSWORD`, `BACKUP_AGE_RECIPIENT` (an `age1…` public key; the private key stays off the mini), `BACKUP_R2_DEST` (e.g. `r2:rota-backups/primary`), `RCLONE_CONFIG_R2_TYPE` (`s3`), `RCLONE_CONFIG_R2_PROVIDER` (`Cloudflare`), `RCLONE_CONFIG_R2_ENDPOINT`, `RCLONE_CONFIG_R2_ACCESS_KEY_ID`, `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` |

`bundle install`, `npm ci` and `next build` run third-party code, so `deploy.sh` runs them with every variable dropped except `HOME`, `PATH`, `TMPDIR`, `LANG`, the runtime paths, `RAILS_ENV`, `TZ`, `BUNDLE_*` and `SENTRY_RELEASE`; `next build` also gets `build.env`, filtered to `NEXT_PUBLIC_*`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` (CI builds web with none of these, so the build needs nothing else). Only `rota-run.sh` and `db:prepare` load `env` with `api.env` or `web.env`.

Set by the scripts, not the files: `RAILS_ENV`, `TZ=UTC` (as the Dockerfile pinned it, for iCal parsing), `BUNDLE_PATH`, `BUNDLE_DEPLOYMENT`, `BUNDLE_WITHOUT`, `SENTRY_RELEASE` (from `current/REVISION`), `NODE_ENV` (web runtime only). Railway's `RAILWAY_GIT_COMMIT_SHA` is gone.

## One-time setup, in ticket order

1. **[BLO-1999](https://linear.app/bloombase/issue/BLO-1999) Check OpenClaw's user and FileVault.** `dscl . -read /Groups/admin GroupMembership` must not list OpenClaw's user; `fdesetup status`. With FileVault on, a power cut stops the mini at the unlock screen until someone unlocks it over SSH.
2. **[BLO-2003](https://linear.app/bloombase/issue/BLO-2003) Accounts.**
   - R2 bucket `rota-backups` and an API token scoped to it (object read and write). Lifecycle rule in the dashboard: bucket, Settings, Object lifecycle rules, add a rule for prefix `primary/` that deletes objects 30 days after upload.
   - Healthchecks.io: check `rota-deploy` (period 5 minutes, grace 30 minutes, so a CI run or build does not alarm) and `rota-backup` (period 1 day, grace 2 hours).
   - `age-keygen -o rota-backup.key` on a machine other than the mini; keep the key in the password manager; its public line is `BACKUP_AGE_RECIPIENT`.
   - Cloudflare Tunnel with the ingress in [`cloudflared/config.yml.example`](cloudflared/config.yml.example). While Railway is production, publish `api.rota.monster` (new, unused by Railway) and a temporary web hostname such as `mini.rota.monster` in place of `rota.monster`.
   - WorkOS: add the redirect URI `https://mini.rota.monster/callback` next to the existing ones; do not replace them while Railway still serves sign-ins. Twilio needs nothing: each text carries its own status callback URL, taken from the sending api's `API_URL`.
3. **[BLO-2004](https://linear.app/bloombase/issue/BLO-2004) Install production on the mini.** Fill every env file in parallel mode (step 4) from the start.
   ```sh
   sudo pmset -a autorestart 1 sleep 0
   # macOS updates by hand: System Settings, General, Software Update, Automatic updates,
   # turn off "Install macOS updates" (leave security responses on), or:
   sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false

   brew install postgresql@16 jemalloc mise age rclone cloudflared libyaml openssl@3
   sudo sysadminctl -addUser rota -fullName "Rota Monster" -password -   # standard user
   sudo dseditgroup -o create rota && sudo dseditgroup -o edit -a rota -t user rota
   sudo mkdir -p /opt/rota/log /usr/local/etc/rota && sudo chown -R rota:rota /opt/rota
   # launchd appends to an existing log; created by rota, deploy.sh can trim them
   for l in api web postgres deploy backup; do sudo -u rota touch /opt/rota/log/$l.log; done
   for f in env api.env web.env build.env deploy.env backup.env; do sudo install -m 0640 -o root -g rota /dev/null /usr/local/etc/rota/$f; done
   # then fill each from env.example with an editor

   sudo -u rota -H /opt/homebrew/bin/mise install ruby@3.4.5 node@22
   sudo -u rota -H git clone https://github.com/bshakr/rota.git /opt/rota/repo
   sudo -u rota -H /opt/homebrew/opt/postgresql@16/bin/initdb -D /opt/rota/pgdata -U rota -E UTF8 --auth-local=peer --auth-host=scram-sha-256
   # put this line first in /opt/rota/pgdata/pg_hba.conf:  local  all  houserota_api  scram-sha-256

   # Root-owned files come from a root-owned checkout at a sha you reviewed on GitHub,
   # never from /opt/rota/repo: rota can write there, and a plist or sudoers file edited
   # between review and install would run as root.
   REVIEWED=<full sha of main you reviewed>
   sudo git clone -q https://github.com/bshakr/rota.git /usr/local/rota-install
   sudo git -C /usr/local/rota-install checkout -q --detach "$REVIEWED"
   sudo git -C /usr/local/rota-install rev-parse HEAD   # must print $REVIEWED
   cd /usr/local/rota-install/deploy/mini
   sudo visudo -cf sudoers-rota && sudo install -m 0440 -o root -g wheel sudoers-rota /etc/sudoers.d/rota
   for d in postgres api web deploy backup; do plutil -lint launchd/monster.rota.$d.plist && sudo install -m 0644 -o root -g wheel launchd/monster.rota.$d.plist /Library/LaunchDaemons/; done
   sudo install -m 0644 -o root -g wheel newsyslog-rota.conf /etc/newsyslog.d/rota.conf
   cd / && sudo rm -rf /usr/local/rota-install
   sudo launchctl bootstrap system /Library/LaunchDaemons/monster.rota.postgres.plist

   sudo -u rota -H /opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c 'CREATE ROLE houserota_api LOGIN' -c '\password houserota_api'
   for db in houserota_api_production houserota_api_production_cache houserota_api_production_queue; do sudo -u rota -H /opt/homebrew/opt/postgresql@16/bin/createdb -O houserota_api $db; done

   # First release by hand: builds, prepares the databases and points current at it, without restarting anything.
   sudo -u rota -H BOOTSTRAP=1 /bin/bash /opt/rota/repo/deploy/mini/deploy.sh
   for d in api web deploy backup; do sudo launchctl bootstrap system /Library/LaunchDaemons/monster.rota.$d.plist; done
   ```
   Then the tunnel: put the config at `/etc/cloudflared/config.yml` and `sudo cloudflared service install`.
4. **[BLO-2005](https://linear.app/bloombase/issue/BLO-2005) Run in parallel, dark.** Railway stays production and keeps texting everyone, so the mini must send nothing and run no jobs. In the env files:
   - `api.env`: set `ROTA_MODE=parallel`, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` to Twilio's **test** credentials (Console, Account, API keys and tokens, Test credentials), and `TWILIO_FROM_NUMBER=+15005550006`, Twilio's magic number that accepts a send and delivers nothing. The api refuses to boot with blank Twilio settings, and refuses `SMS_ADAPTER=null`, in production, so test credentials are the way to boot it dark.
   - leave `SOLID_QUEUE_IN_PUMA` and `SIGNUP_ALERT_PHONE` out entirely: no reminder sweep, no calendar sync, no signup alerts. With `ROTA_MODE=parallel`, `rota-run.sh` refuses to start the api if either is set or the from number is not the test one.
   - `APP_URL`, `CORS_ORIGINS` and `WORKOS_REDIRECT_URI` name `https://mini.rota.monster`; `SENTRY_ENVIRONMENT` says `mini-parallel`, so the mini's server errors stay apart from production's. Leave `NEXT_PUBLIC_SENTRY_ENVIRONMENT` as production: it is baked in at build, and changing it would force a rebuild at cutover.

   Never run `bin/jobs` on the mini in this mode. "Sync now" on a house calendar classifies events with Claude inside the request, so it spends real Anthropic money even here.

   Load a copy of production: from a machine with Railway's public database URL, `pg_dump -Fc --no-owner "$RAILWAY_DATABASE_URL" -f railway.dump`, copy it over, then on the mini `pg_restore --clean --if-exists --no-owner -U houserota_api -d houserota_api_production railway.dump`. Prove the backup path once too: `sudo -u rota -H /bin/bash /opt/rota/current/deploy/mini/backup.sh`, download that object from R2, and `age -d -i rota-backup.key <file>.dump.age | pg_restore --no-owner -d <a scratch database>`. Then check the app on `mini.rota.monster`.
5. **[BLO-2006](https://linear.app/bloombase/issue/BLO-2006) Cut over.** Expect 20 to 30 minutes when nobody can use the app (steps 1 to 7). Start a few minutes after the hour, once Railway's hourly reminder sweep has run, and well before midnight in the houses' time zone: a sweep missed during the switch only makes reminders late (they catch up for 24 hours), except the day-of reminder, which is dropped after midnight. Sentry's `reminder-sweep` monitor may report one missed check-in.
   1. Freeze Railway. Take Railway's web offline (remove its `rota.monster` domain or stop the service), and redeploy Railway's api with `SOLID_QUEUE_IN_PUMA` unset. Users can no longer write and no new texts go out; the api stays up only to take delivery receipts.
   2. Wait 10 minutes for receipts of the last texts to land, then take the final dump: `pg_dump -Fc --no-owner "$RAILWAY_DATABASE_URL" -f final.dump`.
   3. On the mini, stop the api and the deploy job: `sudo launchctl bootout system/monster.rota.deploy; sudo launchctl bootout system/monster.rota.api`.
   4. Restore and clear what the parallel run queued: `pg_restore --clean --if-exists --no-owner -U houserota_api -d houserota_api_production final.dump`; then, as rota, `dropdb houserota_api_production_queue && createdb -O houserota_api houserota_api_production_queue` and `/opt/rota/current/deploy/mini/rota-run.sh exec api ruby bin/rails db:prepare`.
   5. Verify row counts match. Run this against Railway's URL and against the mini (`-U houserota_api houserota_api_production`), and diff the two outputs:
      `psql -At -c "select string_agg(format('select %L, count(*) from %I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname = 'public'" | psql -At`
   6. Go live. In `api.env` delete the parallel block (`ROTA_MODE` and the test Twilio credentials) and set the real `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SOLID_QUEUE_IN_PUMA=1` and `SIGNUP_ALERT_PHONE`. Across the env files, `APP_URL`, `CORS_ORIGINS` and `WORKOS_REDIRECT_URI` move to `https://rota.monster` and `SENTRY_ENVIRONMENT` back to production. `API_URL` stays `https://api.rota.monster`. Then `sudo launchctl bootstrap system /Library/LaunchDaemons/monster.rota.api.plist` and the same for `monster.rota.deploy`, and `sudo launchctl kickstart -k system/monster.rota.web`.
   7. Point `rota.monster` at the tunnel (its public hostname in the tunnel config, which replaces the Railway DNS record) and drop `mini.rota.monster`. Check `https://rota.monster` and `https://api.rota.monster/up`, then send yourself one text.
   8. Keep Railway's api reachable, with jobs off, for 48 hours: Twilio posts receipts for texts sent before the switch to the callback URL each text carried, which is Railway's (ADR 0002). Receipts that land there after the dump update Railway's copy only, so those few texts keep their last status on the mini; their prices are still fetched by `BackfillSmsPricesJob`. Then remove only Rota's Railway services.
