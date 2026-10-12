#!/bin/bash
# shellcheck source-path=SCRIPTDIR
# Pull deploy, run as rota every 5 minutes by monster.rota.deploy.
#   deploy.sh               deploy origin/main's tip once its CI is green
#   deploy.sh rollback SHA  deploy an older commit of main, and hold main's tip back until main moves
# Exit codes: 0 deployed or nothing to do, 1 failed or CI red, 75 CI pending.
# DRY_RUN=1 fetches and checks CI for real, then prints the build steps instead of running them.
# BOOTSTRAP=1 is the first, by-hand run: no daemons to restart or health-check yet.
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DRY_RUN=${DRY_RUN:-0}
BOOTSTRAP=${BOOTSTRAP:-0}
GITHUB_API=${GITHUB_API:-https://api.github.com}
GITHUB_REPO=${GITHUB_REPO:-bshakr/rota}
# Named, not "whatever runs exist": a commit seconds old has zero check-runs,
# and "all of none succeeded" must not read as green.
REQUIRED_CHECKS=${REQUIRED_CHECKS:-apps/api apps/web}
KEEP_RELEASES=3
# CI takes minutes; hours of pending means a run that never started, e.g. [skip ci].
PENDING_ALERT_HOURS=${PENDING_ALERT_HOURS:-6}
LOG_MAX_BYTES=${LOG_MAX_BYTES:-52428800}
API_LABEL=monster.rota.api
WEB_LABEL=monster.rota.web
STATE_DIR="$ROTA_ROOT/state"

step=start
mode=deploy
sha=
main_sha=
candidate=
fail_ping=1
health_timeout=${HEALTH_TIMEOUT:-90}
lock="$ROTA_ROOT/deploy.lock"

run() {
  if [[ $DRY_RUN == 1 ]]; then
    printf 'DRY_RUN would run: %s\n' "$*"
  else
    "$@"
  fi
}

# One line per file under state/, outside any release so a pruned release cannot take it along.
state_get() { [[ -r $STATE_DIR/$1 ]] && cat "$STATE_DIR/$1" || true; }
state_set() { printf '%s\n' "$2" >"$STATE_DIR/$1.tmp" && mv -f "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }

# /fail at most once per (sha, reason): Healthchecks already alerted, and repeats bury a real outage.
fail_once() {
  local key="$1 $2" msg=$3
  if [[ $(state_get alerted) == "$key" ]]; then
    log "$msg (already reported)"
    return 1
  fi
  log "$msg"
  hc_ping HEALTHCHECKS_DEPLOY_URL /fail "$msg"
  state_set alerted "$key"
}

on_exit() {
  local status=$?
  if [[ $DRY_RUN != 1 ]]; then
    if [[ $status -ne 0 && -n $candidate ]]; then
      # A failed rollback keeps main's tip held back rather than freeing it.
      [[ $mode == rollback ]] || state_set failed "$sha $step"
      if [[ ${candidate##*/} != "$(current_release)" ]]; then
        log "removing failed release $candidate"
        rm -rf "$candidate"
      fi
      prune_releases "" || true
    fi
    if [[ $status -ne 0 && $fail_ping == 1 ]]; then
      local msg="deploy ${sha:-?} failed at step '$step' (exit $status); see $ROTA_ROOT/log/deploy.log"
      if [[ -n $candidate ]]; then
        fail_once "$sha" failed "$msg; skipped until main moves" || true
      else
        hc_ping HEALTHCHECKS_DEPLOY_URL /fail "$msg"
      fi
    fi
    rm -f "$lock"
  fi
}

# 0 green, 1 red, 75 pending or unknown.
ci_status() {
  local commit=$1 json total listed name state bad=0 pending=0
  if ! json=$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' \
    "$GITHUB_API/repos/$GITHUB_REPO/commits/$commit/check-runs?per_page=100"); then
    log "could not read check-runs for $commit"
    return 75
  fi
  total=$(jq -r '.total_count' <<<"$json")
  listed=$(jq -r '.check_runs | length' <<<"$json")
  if [[ $total != "$listed" ]]; then
    log "$total check-runs but only $listed listed; refusing"
    return 75
  fi
  for name in $REQUIRED_CHECKS; do
    if ! jq -e --arg n "$name" 'any(.check_runs[]; .name == $n)' <<<"$json" >/dev/null; then
      log "required check '$name' has not started on $commit"
      pending=1
    fi
  done
  while IFS=$'\t' read -r name state; do
    [[ -z $name ]] && continue
    case $state in
      completed/success) ;;
      completed/*) log "check '$name' is $state on $commit"; bad=1 ;;
      *) log "check '$name' is $state on $commit"; pending=1 ;;
    esac
  done < <(jq -r '.check_runs[] | [.name, "\(.status)/\(.conclusion // "none")"] | @tsv' <<<"$json")
  if [[ $bad == 1 ]]; then return 1; fi
  if [[ $pending == 1 ]]; then return 75; fi
  return 0
}

http_is() {
  local want=$1 code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$2" || true)
  [[ $code == "$want" ]]
}

wait_healthy() {
  local deadline=$(($(date +%s) + health_timeout))
  while :; do
    if http_is 200 http://127.0.0.1:3000/up && http_is 200 http://127.0.0.1:3001/; then
      return 0
    fi
    if (($(date +%s) >= deadline)); then break; fi
    sleep 2
  done
  log "api /up or web / did not answer 200 within ${health_timeout}s"
  return 1
}

# launchd's pid for a daemon, empty when it is not running. Readable without root.
svc_pid() {
  launchctl print "system/$1" 2>/dev/null | awk '$1 == "pid" && $2 == "=" { print $3; exit }'
}

# kickstart -k returns before the old process has exited. launchd never runs two
# instances of a job, so a new pid means the old process is gone and whatever
# answers on the port from then on is the new release.
wait_new_pid() {
  local label=$1 old=$2 pid _
  for _ in $(seq 1 60); do
    pid=$(svc_pid "$label")
    if [[ -n $pid && $pid != "$old" ]]; then
      printf '%s' "$pid"
      return 0
    fi
    sleep 1
  done
  log "$label still on pid ${old:-none} 60s after kickstart"
  return 1
}

restart_and_check() {
  local api_old web_old api_new web_new label
  api_old=$(svc_pid "$API_LABEL")
  web_old=$(svc_pid "$WEB_LABEL")
  for label in "$API_LABEL" "$WEB_LABEL"; do
    sudo -n /bin/launchctl kickstart -k "system/$label" || { log "kickstart of $label failed"; return 1; }
  done
  api_new=$(wait_new_pid "$API_LABEL" "$api_old") || return 1
  web_new=$(wait_new_pid "$WEB_LABEL" "$web_old") || return 1
  wait_healthy || return 1
  # A release that answers once and then dies is respawned by KeepAlive under another pid.
  if [[ $(svc_pid "$API_LABEL") != "$api_new" || $(svc_pid "$WEB_LABEL") != "$web_new" ]]; then
    log "api or web restarted again during the health check"
    return 1
  fi
}

switch_to() {
  run ln -sfn "$1" "$ROTA_ROOT/current.new"
  run mv -fh "$ROTA_ROOT/current.new" "$ROTA_ROOT/current"
}

current_release() {
  local target
  target=$(readlink "$ROTA_ROOT/current" 2>/dev/null) || return 0
  printf '%s' "${target##*/}"
}

# Runs a build command with only the build variables; see build_env in lib.sh.
build_run() {
  local dir=$1 app=$2 with_build_vars=$3
  shift 3
  (build_env "$with_build_vars" && use_runtimes "$dir" && cd "$dir/apps/$app" && "$@")
}

build_release() {
  local dir=$1
  step="unpack $sha"
  run rm -rf "$dir"
  run mkdir -p "$dir"
  if [[ $DRY_RUN == 1 ]]; then
    printf 'DRY_RUN would run: git -C %s archive %s | tar -x -C %s\n' "$ROTA_REPO" "$sha" "$dir"
  else
    git -C "$ROTA_REPO" archive "$sha" | tar -x -C "$dir"
    printf '%s\n' "$sha" >"$dir/REVISION"
  fi

  step="install runtimes"
  local ruby_version
  ruby_version=$(git -C "$ROTA_REPO" show "$sha:apps/api/.ruby-version")
  run mise install "ruby@$ruby_version" "node@$NODE_VERSION"
  [[ $DRY_RUN == 1 ]] && { printf 'DRY_RUN would bundle install, npm ci, npm run build (SENTRY_RELEASE=%s) in %s\n' "$sha" "$dir"; return 0; }

  step="bundle install"
  build_run "$dir" api 0 ruby -S bundle install --quiet
  # NODE_ENV stays unset here: npm ci under production would skip the devDependencies next build needs.
  step="npm ci"
  build_run "$dir" web 0 npm ci --no-audit --no-fund
  step="next build"
  build_run "$dir" web 1 npm run build
  touch "$dir/.built"
}

# Keeps current, the previous release (the rollback target), and the newest other
# built releases up to KEEP_RELEASES in all. Unbuilt (failed) ones always go.
prune_releases() {
  local cur prev=${1##*/} n=0 dir name
  cur=$(current_release)
  [[ -n $cur ]] && n=1
  [[ -n $prev && $prev != "$cur" && -d $ROTA_ROOT/releases/$prev ]] && n=$((n + 1))
  for dir in "$ROTA_ROOT"/releases/*/; do
    [[ -d $dir ]] || continue
    dir=${dir%/}
    if [[ -e $dir/.built ]]; then
      printf '%s %s\n' "$(stat -f %m "$dir/.built")" "$dir"
    else
      printf '0 %s\n' "$dir"
    fi
  done | sort -rn | cut -d' ' -f2- | {
    while IFS= read -r dir; do
      name=${dir##*/}
      [[ $name == "$cur" || $name == "$prev" ]] && continue
      if [[ -e $dir/.built && $n -lt $KEEP_RELEASES ]]; then
        n=$((n + 1))
        continue
      fi
      log "removing release $name"
      rm -rf "$dir"
    done
  }
}

# Gems are shared across releases, so clean only when every kept release locks
# the same gems; otherwise a rollback would start without its gems.
clean_gems() {
  local cur dir
  cur=$ROTA_ROOT/releases/$(current_release)
  for dir in "$ROTA_ROOT"/releases/*/; do
    dir=${dir%/}
    if ! cmp -s "$dir/apps/api/Gemfile.lock" "$cur/apps/api/Gemfile.lock"; then
      log "kept releases lock different gems; bundle clean waits"
      return 0
    fi
  done
  build_run "$cur" api 0 ruby -S bundle clean
}

# api, web and postgres hold their logs open (launchd opens them), so newsyslog's
# rename would leave them writing to the rotated file. Copy, then truncate in place.
trim_logs() {
  local name file
  for name in api web postgres; do
    file=$ROTA_ROOT/log/$name.log
    [[ -f $file && $(stat -f %z "$file") -gt $LOG_MAX_BYTES ]] || continue
    if gzip -c "$file" >"$file.1.gz" && : >"$file"; then
      log "trimmed $file to $file.1.gz"
    else
      log "could not trim $file"
    fi
  done
}

# Up to 10 minutes since boot, postgres, puma and next may still be starting.
boot_grace() {
  local boot
  boot=$(sysctl -n kern.boottime | sed -E 's/^\{ sec = ([0-9]+).*/\1/')
  if [[ $boot =~ ^[0-9]+$ ]] && (($(date +%s) - boot < 600)); then
    health_timeout=${BOOT_HEALTH_TIMEOUT:-300}
    log "booted $(($(date +%s) - boot))s ago; allowing ${health_timeout}s for services to come up"
  fi
}

# The running release is healthy: the deploy check doubles as the mini's heartbeat.
heartbeat() {
  [[ $DRY_RUN == 1 ]] && return 0
  local note=$1 was=$step
  step="health"
  wait_healthy
  hc_ping HEALTHCHECKS_DEPLOY_URL "" "up at ${deployed:-nothing}${note:+; $note}"
  step=$was
}

# After a rollback the job must not put main's tip straight back.
hold_main() {
  [[ $DRY_RUN != 1 && $sha != "$main_sha" ]] || return 0
  state_set failed "$main_sha held back by rollback to $sha"
  log "holding main at $main_sha back until main moves"
}

main() {
  mode=${1:-deploy}
  local wanted=${2:-}
  case $mode in
    deploy) ;;
    rollback) [[ -n $wanted ]] || { echo "usage: deploy.sh rollback <sha>" >&2; exit 64; } ;;
    *) echo "usage: deploy.sh [rollback <sha>]" >&2; exit 64 ;;
  esac

  if [[ $DRY_RUN != 1 ]]; then
    mkdir -p "$ROTA_ROOT/releases" "$ROTA_ROOT/shared" "$ROTA_ROOT/log" "$STATE_DIR"
    if ! shlock -f "$lock" -p $$; then
      log "another deploy holds $lock"
      fail_ping=0
      [[ $mode == rollback ]] && { log "rollback not run; retry in a minute"; exit 75; }
      exit 0
    fi
  fi
  trap on_exit EXIT

  step="load env"
  # shellcheck disable=SC2034 # read by hc_ping through ${!1}
  HEALTHCHECKS_DEPLOY_URL=$(env_value deploy.env HEALTHCHECKS_DEPLOY_URL)
  [[ $DRY_RUN == 1 ]] || boot_grace

  step="fetch"
  git -C "$ROTA_REPO" fetch --quiet origin "+refs/heads/main:refs/remotes/origin/main"
  main_sha=$(git -C "$ROTA_REPO" rev-parse --verify "origin/main^{commit}")
  if [[ $mode == rollback ]]; then
    sha=$(git -C "$ROTA_REPO" rev-parse --verify "$wanted^{commit}")
    if ! git -C "$ROTA_REPO" merge-base --is-ancestor "$sha" "$main_sha"; then
      log "REFUSED: $sha is not on main"
      fail_ping=0
      exit 1
    fi
  else
    sha=$main_sha
  fi

  deployed=""
  [[ -r $ROTA_ROOT/current/REVISION ]] && deployed=$(<"$ROTA_ROOT/current/REVISION")
  step="trim logs"
  [[ $DRY_RUN == 1 ]] || trim_logs

  if [[ $sha == "$deployed" ]]; then
    [[ $mode == rollback ]] && hold_main
    if [[ $DRY_RUN == 1 ]]; then
      log "dry run: $sha is already deployed, nothing to do"
      return 0
    fi
    heartbeat ""
    return 0
  fi

  if [[ $mode == deploy && $DRY_RUN != 1 ]]; then
    local failed
    failed=$(state_get failed)
    if [[ ${failed%% *} == "$sha" ]]; then
      log "skipping $sha: it failed at '${failed#* }'; waiting for main to move (to retry: rm $STATE_DIR/failed $STATE_DIR/alerted)"
      # No success ping: it would clear the /fail alert while main stays undeployed.
      fail_ping=0
      exit 1
    fi
  fi

  step="ci check"
  log "target $sha, deployed ${deployed:-none}"
  local ci=0
  ci_status "$sha" || ci=$?
  case $ci in
    0) log "CI green on $sha" ;;
    75)
      log "REFUSED: CI on $sha is pending or unknown; will retry next run"
      if [[ $DRY_RUN != 1 ]]; then
        local pending since
        pending=$(state_get pending)
        if [[ ${pending%% *} == "$sha" ]]; then since=${pending#* }; else since=$(date +%s); state_set pending "$sha $since"; fi
        if (($(date +%s) - since > PENDING_ALERT_HOURS * 3600)); then
          fail_once "$sha" pending "CI on main at $sha has been pending for over ${PENDING_ALERT_HOURS}h (never started, or [skip ci]); still running ${deployed:-nothing}" || true
        else
          heartbeat "CI pending on $sha"
        fi
      fi
      fail_ping=0
      exit 75
      ;;
    *)
      log "REFUSED: CI on $sha is red; not deploying"
      if [[ $DRY_RUN != 1 ]]; then
        fail_once "$sha" red "main at $sha has red CI; still running ${deployed:-nothing}" || true
      fi
      fail_ping=0
      exit 1
      ;;
  esac

  [[ $mode == rollback ]] && hold_main

  local release="$ROTA_ROOT/releases/$sha" previous=""
  [[ -L $ROTA_ROOT/current ]] && previous=$(readlink "$ROTA_ROOT/current")
  # The running release is never a candidate to delete on failure.
  [[ ${previous##*/} == "$sha" ]] || candidate=$release

  # Everything up to the switch leaves the running version untouched.
  if [[ -e $release/.built ]]; then
    log "release $sha already built"
  else
    build_release "$release"
  fi

  step="wait for postgres"
  run pg_isready -q -t $((health_timeout > 30 ? health_timeout : 30))

  step="db:prepare"
  # db:prepare, not db:migrate: cache and queue have schema files but no migrations,
  # so only prepare creates and loads them on a fresh machine.
  if [[ $DRY_RUN == 1 ]]; then
    printf 'DRY_RUN would run: ruby bin/rails db:prepare in %s/apps/api\n' "$release"
  else
    (load_env api && use_runtimes "$release" && cd "$release/apps/api" && ruby bin/rails db:prepare)
  fi

  step="switch"
  switch_to "releases/$sha"

  if [[ $DRY_RUN == 1 ]]; then
    printf 'DRY_RUN would kickstart %s and %s, wait for new pids, then require 200 from /up and /\n' "$API_LABEL" "$WEB_LABEL"
    log "dry run: would deploy $sha"
    return 0
  fi

  if [[ $BOOTSTRAP == 1 ]]; then
    candidate=
    log "bootstrap: $sha is current; load the api and web daemons next"
    return 0
  fi

  step="restart and health check"
  if ! restart_and_check; then
    if [[ -n $previous ]]; then
      log "rolling back to $previous"
      switch_to "$previous"
      restart_and_check || log "the previous release did not come back healthy either"
    fi
    exit 1
  fi
  candidate=

  step="prune"
  prune_releases "${previous:+$ROTA_ROOT/$previous}"
  clean_gems || log "bundle clean failed; continuing"
  hc_ping HEALTHCHECKS_DEPLOY_URL "" "deployed $sha"
  log "deployed $sha"
}

main "$@"
