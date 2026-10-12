# API memory on the Mac mini

How the api is started so it stays one small Ruby process. Decided in
[ADR 0002](../adr/0002-host-rota-monster-on-the-mac-mini-behind-a-cloudflare-tunnel.md); the
deploy scripts themselves are [BLO-2002](https://linear.app/bloombase/issue/BLO-2002).

## One process: Solid Queue inside Puma

Set `SOLID_QUEUE_IN_PUMA=1` and do not run `bin/jobs`. `config/puma.rb` then loads the Solid Queue
plugin in async mode: the supervisor, worker, dispatcher and scheduler run as threads in the Puma
process. Recurring tasks from `config/recurring.yml` fire as before.

- `config/puma.rb` loads our plugin (`lib/puma/plugin/solid_queue_async.rb`), not the gem's. A
  watchdog thread checks every 2 s that the Solid Queue supervisor thread is alive (and that its
  worker, dispatcher and scheduler threads are, over 3 checks). If not, it logs, reports to
  Sentry (source `rotamonster.queue`) and sends the process TERM, so launchd's `KeepAlive` or
  Railway's restart policy brings it back; the exit status is 143. Without it, a queue-database
  blip could stop every job while `/up` stayed 200.
- Leave `WEB_CONCURRENCY` unset. In Puma cluster mode the plugin starts in the master process,
  not in the workers that load the app.
- `JOB_THREADS` (default 3) sets the job threads; `JOB_CONCURRENCY` is ignored in async mode.
- The pools in `config/database.yml` grow with `RAILS_MAX_THREADS` and `JOB_THREADS`, so change
  those two variables, never the pool numbers.

Measured on a MacBook (development, after boot and one job, 2026-10-12): fork mode was 5 Ruby
processes at 548,032 KB RSS in total; async mode is 1 process at 148,368 KB.

## Stopping and restarting

On TERM, Puma first stops Solid Queue and only then drains web requests. The numbers:

| Setting | Value | Where |
| --- | --- | --- |
| `SolidQueue.shutdown_timeout`: running jobs get this long to finish | 10 s | `config/application.rb` |
| Puma `force_shutdown_after`: in-flight requests get this long after that | 8 s | `config/puma.rb` |
| launchd `ExitTimeOut`: SIGKILL after | 30 s | `deploy/mini/launchd/monster.rota.api.plist` |
| Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`: SIGKILL after | set to 30 (Railway's default is 0) | Railway api service variables |

A normal stop takes at most about 19 s (10 + 8, plus deregistration), inside 30. A job still
running at 10 s is cut: in async mode Solid Queue then calls `exit!` on the whole process, which
also cuts any request in flight. The job is released and runs again after the restart, so jobs
must be safe to run twice (they are; see `app/jobs`). A text cut mid-send stays `sending` and is
not retried, as in fork mode. Railway's default draining of 0 s means SIGKILL straight after TERM,
so until that variable is set none of this runs there.

Restart with a full stop: `launchctl kickstart -k system/monster.rota.api` on the mini, a
redeploy on Railway. Do not hot-restart Puma (SIGUSR2, SIGUSR1, `pumactl restart`): our plugin
stops the queue and starts no replacement before the exec, so nothing is lost, but it gains
nothing over a full restart and is not what the deploy scripts exercise.

## Allocator settings

- **`MALLOC_ARENA_MAX=2`** is a glibc setting: it limits malloc arenas on Linux when glibc malloc
  is in use, and does nothing on macOS or under jemalloc (which `apps/api/Dockerfile` preloads).
  Setting it on the mini is harmless but inert; it matters only on a Linux host without jemalloc.
- **jemalloc** on the mini: `brew install jemalloc`, then set
  `DYLD_INSERT_LIBRARIES=/opt/homebrew/opt/jemalloc/lib/libjemalloc.dylib` in the LaunchDaemon's
  environment. macOS strips `DYLD_*` variables when it launches a system binary, and `bin/rails`
  starts through `#!/usr/bin/env ruby`, so the variable is lost unless the daemon runs the Ruby
  binary itself: `/path/to/ruby-3.4.5/bin/ruby bin/rails server`, not `bin/rails server` and not an
  rbenv shim. Check it took effect with `vmmap <pid> | grep jemalloc`.
- In the measurement above jemalloc did not lower idle RSS on macOS (151,168 KB with it). Its gain
  is in fragmentation over days of uptime, so judge it by RSS after a week, not after boot.
