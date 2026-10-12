# Production on the Mac mini

How [ADR 0002](../../docs/adr/0002-host-rota-monster-on-the-mac-mini-behind-a-cloudflare-tunnel.md) runs: five LaunchDaemons under the standard user `rota`, a Cloudflare Tunnel in front, Healthchecks.io watching.

| Daemon | Runs | When |
| --- | --- | --- |
| `monster.rota.postgres` | Homebrew `postgresql@16` (CI's major), data in `/opt/rota/pgdata` | always |
| `monster.rota.api` | `rota-run.sh api`: Puma with Solid Queue inside, `127.0.0.1:3000` | always |
| `monster.rota.web` | `rota-run.sh web`: `next start`, `127.0.0.1:3001` | always |
| `monster.rota.deploy` | `deploy.sh` | every 5 minutes |
| `monster.rota.backup` | `backup.sh` | 03:15 daily |

Layout: `/opt/rota/repo` (clone, fetch only), `/opt/rota/releases/<sha>` (one build per commit), `/opt/rota/current` (symlink the daemons start from), `/opt/rota/shared/bundle` (gems), `/opt/rota/log/<daemon>.log`.

## How it behaves

- **Runtimes** come from mise: one tool for Ruby and Node, reading the `apps/api/.ruby-version` of the release being run. Node is 22, the version CI builds with. The wrapper execs the absolute install path, never a shim.
- **Deploy** fetches `origin/main`. If it differs from `current/REVISION`, it asks the public GitHub API for the commit's check-runs and goes on only when `apps/api` and `apps/web` are both present, completed and successful. Pending exits 75 and retries next run; red exits 1 and pings `/fail`. It then builds a fresh `releases/<sha>` (`bundle install`, `npm ci`, `npm run build` with `SENTRY_RELEASE=<sha>`), runs `bin/rails db:prepare`, swaps the `current` symlink, restarts api and web, and waits for `/up` and the web root. A failed build leaves the old release running. A failed health check after the restart swaps back. Migrations are not rolled back, so they must stay compatible with the previous release. A run with nothing to deploy still health-checks and pings, so the deploy check is also the mini's heartbeat. `DRY_RUN=1` does the fetch and the CI check for real and prints everything after.
- **Rollback** by hand: `ln -sfn releases/<old sha> /opt/rota/current.new && mv -fh /opt/rota/current.new /opt/rota/current`, then kickstart api and web. The deploy job puts `main` back on its next run, so first revert on `main` or `launchctl bootout system/monster.rota.deploy`.
- **jemalloc** is active for the api. The wrapper exports `DYLD_INSERT_LIBRARIES` itself because SIP strips `DYLD_*` whenever a protected binary such as `/bin/bash` or `/usr/bin/env` starts, so the variable cannot live in the plist. `MALLOC_ARENA_MAX` is a glibc setting and does nothing on macOS; `MALLOC_CONF=narenas:2` is the jemalloc equivalent. To confirm on the mini: `sudo -u rota -H /opt/rota/current/deploy/mini/rota-run.sh exec api /bin/bash -c 'DYLD_INSERT_LIBRARIES=/opt/homebrew/opt/jemalloc/lib/libjemalloc.2.dylib MALLOC_CONF=stats_print:true exec ruby -e 1' 2>&1 | head -2` prints `Begin jemalloc statistics`.
- **Logs** are held open by launchd, so trim them with `: > file`, never `mv`.

## Secrets

`/usr/local/etc/rota/env`, owner `root`, group `rota`, mode `0640`, plus optional `api.env` and `web.env` beside it that override it for one app. One `KEY=value` per line, no quotes, no `export`; values are read literally and never printed. The ADR says root-owned `0600`, but the daemons run as `rota` and could not read that; group `rota` is a dedicated group so admin users in `staff` cannot.

Names only, never values:

- **api**: `SECRET_KEY_BASE`, `APP_URL`, `API_URL` (`https://api.rota.monster`), `CORS_ORIGINS`, `HOUSEROTA_API_DATABASE_PASSWORD`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_JWT_ISSUER`, `SUPER_ADMIN_WORKOS_USER_IDS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `DEFAULT_PHONE_COUNTRY`, `SIGNUP_ALERT_PHONE`, `ANTHROPIC_API_KEY`, `ANALYTICS_SHARED_SECRET`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SPEND_GBP_PER_USD`, `FIXED_MONTHLY_COST_GBP`, `SMS_ESTIMATED_SEGMENT_COST_GBP`, `SOLID_QUEUE_IN_PUMA` (`1`), `RAILS_MAX_THREADS`, `JOB_CONCURRENCY`, `RAILS_LOG_LEVEL`.
- **web runtime**: `API_URL`, `APP_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`, `SUPER_ADMIN_WORKOS_USER_IDS`, `ANALYTICS_SHARED_SECRET`, `SENTRY_ENVIRONMENT`. `API_URL` for web can be `http://127.0.0.1:3000` in `web.env`, which skips the trip out through Cloudflare.
- **web build**: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
- **mini only**: `HEALTHCHECKS_DEPLOY_URL`, `HEALTHCHECKS_BACKUP_URL`, `BACKUP_AGE_RECIPIENT` (an `age1…` public key; the private key stays off the mini), `BACKUP_R2_DEST` (e.g. `r2:rota-backups/primary`), `RCLONE_CONFIG_R2_TYPE` (`s3`), `RCLONE_CONFIG_R2_PROVIDER` (`Cloudflare`), `RCLONE_CONFIG_R2_ENDPOINT`, `RCLONE_CONFIG_R2_ACCESS_KEY_ID`, `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY`.
- **set by the scripts, not the file**: `RAILS_ENV`, `TZ=UTC` (as the Dockerfile pinned it, for iCal parsing), `BUNDLE_PATH`, `BUNDLE_DEPLOYMENT`, `BUNDLE_WITHOUT`, `SENTRY_RELEASE` (from `current/REVISION`), `NODE_ENV` (web runtime only). Railway's `RAILWAY_GIT_COMMIT_SHA` is gone.

## One-time setup, in ticket order

1. **[BLO-1999](https://linear.app/bloombase/issue/BLO-1999) Check OpenClaw's user and FileVault.** `dscl . -read /Groups/admin GroupMembership` must not list OpenClaw's user; `fdesetup status`. With FileVault on, a power cut stops the mini at the unlock screen until someone unlocks it over SSH.
2. **[BLO-2003](https://linear.app/bloombase/issue/BLO-2003) Accounts.**
   - R2 bucket `rota-backups` and an API token scoped to it (object read and write). Lifecycle rule in the dashboard: bucket, Settings, Object lifecycle rules, add a rule for prefix `primary/` that deletes objects 30 days after upload.
   - Healthchecks.io: check `rota-deploy` (period 5 minutes, grace 30 minutes, so a CI run or build does not alarm) and `rota-backup` (period 1 day, grace 2 hours).
   - `age-keygen -o rota-backup.key` on a machine other than the mini; keep the key in the password manager; its public line is `BACKUP_AGE_RECIPIENT`.
   - Cloudflare Tunnel with the ingress in [`cloudflared/config.yml.example`](cloudflared/config.yml.example), the `api.rota.monster` hostname, and Twilio/WorkOS callback settings pointing at the new hosts.
3. **[BLO-2004](https://linear.app/bloombase/issue/BLO-2004) Install production on the mini.**
   ```sh
   sudo pmset -a autorestart 1 sleep 0
   # macOS updates by hand: System Settings, General, Software Update, Automatic updates,
   # turn off "Install macOS updates" (leave security responses on), or:
   sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false

   brew install postgresql@16 jemalloc mise age rclone cloudflared libyaml openssl@3
   sudo sysadminctl -addUser rota -fullName "Rota Monster" -password -   # standard user
   sudo dseditgroup -o create rota && sudo dseditgroup -o edit -a rota -t user rota
   sudo mkdir -p /opt/rota/log /usr/local/etc/rota && sudo chown -R rota:rota /opt/rota
   sudo install -m 0640 -o root -g rota /dev/null /usr/local/etc/rota/env   # then fill it with an editor

   sudo -u rota -H /opt/homebrew/bin/mise install ruby@3.4.5 node@22
   sudo -u rota -H git clone https://github.com/bshakr/rota.git /opt/rota/repo
   sudo -u rota -H /opt/homebrew/opt/postgresql@16/bin/initdb -D /opt/rota/pgdata -U rota -E UTF8 --auth-local=peer --auth-host=scram-sha-256
   # put this line first in /opt/rota/pgdata/pg_hba.conf:  local  all  houserota_api  scram-sha-256

   sudo visudo -cf /opt/rota/repo/deploy/mini/sudoers-rota && sudo install -m 0440 -o root -g wheel /opt/rota/repo/deploy/mini/sudoers-rota /etc/sudoers.d/rota
   for d in postgres api web deploy backup; do sudo install -m 0644 -o root -g wheel /opt/rota/repo/deploy/mini/launchd/monster.rota.$d.plist /Library/LaunchDaemons/; done
   sudo launchctl bootstrap system /Library/LaunchDaemons/monster.rota.postgres.plist

   sudo -u rota -H /opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c 'CREATE ROLE houserota_api LOGIN' -c '\password houserota_api'
   for db in houserota_api_production houserota_api_production_cache houserota_api_production_queue; do sudo -u rota -H /opt/homebrew/opt/postgresql@16/bin/createdb -O houserota_api $db; done

   # First release by hand: builds, prepares the databases and points current at it, without restarting anything.
   sudo -u rota -H BOOTSTRAP=1 /bin/bash /opt/rota/repo/deploy/mini/deploy.sh
   for d in api web deploy backup; do sudo launchctl bootstrap system /Library/LaunchDaemons/monster.rota.$d.plist; done
   ```
   Then the tunnel: put the config at `/etc/cloudflared/config.yml` and `sudo cloudflared service install`.
4. **[BLO-2005](https://linear.app/bloombase/issue/BLO-2005) Restore a backup and run in parallel.** Download one object from R2, then `age -d -i rota-backup.key file.dump.age | pg_restore --clean --if-exists --no-owner -U houserota_api -d houserota_api_production`. Check the app on the tunnel hostnames while Railway still serves the real ones.
5. **[BLO-2006](https://linear.app/bloombase/issue/BLO-2006) Cut over.** Switch DNS, set `API_URL` to `https://api.rota.monster`, keep Railway's api up until delivery receipts for texts sent before the switch have arrived, then remove only Rota's Railway services.
