# API memory on the Mac mini

How the api is started so it stays one small Ruby process. Decided in
[ADR 0002](../adr/0002-host-rota-monster-on-the-mac-mini-behind-a-cloudflare-tunnel.md); the
deploy scripts themselves are [BLO-2002](https://linear.app/bloombase/issue/BLO-2002).

## One process: Solid Queue inside Puma

Set `SOLID_QUEUE_IN_PUMA=1` and do not run `bin/jobs`. `config/puma.rb` then loads the Solid Queue
plugin in async mode: the supervisor, worker, dispatcher and scheduler run as threads in the Puma
process. Recurring tasks from `config/recurring.yml` fire as before.

- Leave `WEB_CONCURRENCY` unset. Puma cluster mode would run a scheduler in every worker.
- `JOB_THREADS` (default 3) sets the job threads; `JOB_CONCURRENCY` is ignored in async mode.
- The pools in `config/database.yml` grow with `RAILS_MAX_THREADS` and `JOB_THREADS`, so change
  those two variables, never the pool numbers.

Measured on a MacBook (development, after boot and one job, 2026-10-12): fork mode was 5 Ruby
processes at 548,032 KB RSS in total; async mode is 1 process at 148,368 KB.

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
