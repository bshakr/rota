#!/bin/bash
# shellcheck source-path=SCRIPTDIR
# Pull deploy, run as rota every 5 minutes by monster.rota.deploy.
# Exit codes: 0 deployed or nothing to do, 1 failed or CI red, 75 CI pending.
# DRY_RUN=1 fetches and checks CI for real, then prints the build steps instead of running them.
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DRY_RUN=${DRY_RUN:-0}
DEPLOY_REF=${DEPLOY_REF:-origin/main}
GITHUB_API=${GITHUB_API:-https://api.github.com}
GITHUB_REPO=${GITHUB_REPO:-bshakr/rota}
# Named, not "whatever runs exist": a commit seconds old has zero check-runs,
# and "all of none succeeded" must not read as green.
REQUIRED_CHECKS=${REQUIRED_CHECKS:-apps/api apps/web}
KEEP_RELEASES=3
API_LABEL=monster.rota.api
WEB_LABEL=monster.rota.web

step=start
sha=
fail_ping=1
lock="$ROTA_ROOT/deploy.lock"

run() {
  if [[ $DRY_RUN == 1 ]]; then
    printf 'DRY_RUN would run: %s\n' "$*"
  else
    "$@"
  fi
}

on_exit() {
  local status=$?
  if [[ $status -ne 0 && $fail_ping == 1 && $DRY_RUN != 1 ]]; then
    hc_ping HEALTHCHECKS_DEPLOY_URL /fail "deploy ${sha:-?} failed at step '$step' (exit $status); see $ROTA_ROOT/log/deploy.log"
  fi
  if [[ $DRY_RUN != 1 ]]; then rm -f "$lock"; fi
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

http_ok() {
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" || true)
  [[ $code =~ ^[1-4][0-9][0-9]$ ]]
}

wait_healthy() {
  local i
  for i in $(seq 1 45); do
    if http_ok http://127.0.0.1:3000/up && http_ok http://127.0.0.1:3001/; then
      return 0
    fi
    sleep 2
  done
  log "api or web not healthy after 90s (last try $i)"
  return 1
}

loaded() { launchctl print "system/$1" >/dev/null 2>&1; }

restart() {
  local label
  for label in "$@"; do
    if [[ $DRY_RUN != 1 ]] && ! loaded "$label"; then
      log "$label is not loaded yet, not restarting it"
      continue
    fi
    run sudo -n /bin/launchctl kickstart -k "system/$label"
  done
}

switch_to() {
  run ln -sfn "$1" "$ROTA_ROOT/current.new"
  run mv -fh "$ROTA_ROOT/current.new" "$ROTA_ROOT/current"
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
  (load_env api && use_runtimes "$dir" && cd "$dir/apps/api" && ruby -S bundle install --quiet)

  # NODE_ENV stays unset here: npm ci under production would skip the devDependencies next build needs.
  step="npm ci"
  (load_env web && use_runtimes "$dir" && cd "$dir/apps/web" && npm ci --no-audit --no-fund)
  step="next build"
  (load_env web && use_runtimes "$dir" && cd "$dir/apps/web" && npm run build)
  touch "$dir/.built"
}

prune_releases() {
  local keep_a keep_b dir
  keep_a=$(cd "$ROTA_ROOT/current" && pwd -P)
  keep_b=${1:-}
  stat -f '%m %N' "$ROTA_ROOT"/releases/*/ 2>/dev/null | sort -rn | cut -d' ' -f2- | tail -n +$((KEEP_RELEASES + 1)) |
    while IFS= read -r dir; do
      dir=${dir%/}
      [[ $dir == "$keep_a" || $dir == "$keep_b" ]] && continue
      log "removing old release $dir"
      rm -rf "$dir"
    done
}

main() {
  if [[ $DRY_RUN != 1 ]]; then
    mkdir -p "$ROTA_ROOT/releases" "$ROTA_ROOT/shared" "$ROTA_ROOT/log"
    if ! shlock -f "$lock" -p $$; then
      log "another deploy holds $lock"
      fail_ping=0
      exit 0
    fi
  fi
  trap on_exit EXIT

  step="load env"
  load_env ""

  step="fetch"
  git -C "$ROTA_REPO" fetch --quiet origin "+refs/heads/main:refs/remotes/origin/main"
  sha=$(git -C "$ROTA_REPO" rev-parse --verify "$DEPLOY_REF^{commit}")

  local deployed=""
  [[ -r $ROTA_ROOT/current/REVISION ]] && deployed=$(<"$ROTA_ROOT/current/REVISION")

  if [[ $sha == "$deployed" ]]; then
    step="health"
    if [[ $DRY_RUN == 1 ]]; then
      log "dry run: $sha is already deployed, nothing to do"
      return 0
    fi
    wait_healthy
    hc_ping HEALTHCHECKS_DEPLOY_URL "" "up at $sha"
    return 0
  fi

  step="ci check"
  log "target $sha, deployed ${deployed:-none}"
  local ci=0
  ci_status "$sha" || ci=$?
  case $ci in
    0) log "CI green on $sha" ;;
    75)
      log "REFUSED: CI on $sha is pending or unknown; will retry next run"
      fail_ping=0
      exit 75
      ;;
    *)
      log "REFUSED: CI on $sha is red; not deploying"
      fail_ping=0
      [[ $DRY_RUN != 1 ]] && hc_ping HEALTHCHECKS_DEPLOY_URL /fail "main at $sha has red CI; still running ${deployed:-nothing}"
      exit 1
      ;;
  esac

  local release="$ROTA_ROOT/releases/$sha" previous=""
  [[ -L $ROTA_ROOT/current ]] && previous=$(readlink "$ROTA_ROOT/current")

  # Everything up to the switch leaves the running version untouched.
  if [[ -e $release/.built ]]; then
    log "release $sha already built"
  else
    build_release "$release"
  fi

  step="wait for postgres"
  run pg_isready -q -t 30

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
  step="restart"
  restart "$API_LABEL" "$WEB_LABEL"

  if [[ $DRY_RUN == 1 ]]; then
    log "dry run: would deploy $sha"
    return 0
  fi

  step="health after restart"
  if loaded "$API_LABEL" && ! wait_healthy; then
    if [[ -n $previous ]]; then
      log "rolling back to $previous"
      switch_to "$previous"
      restart "$API_LABEL" "$WEB_LABEL"
    fi
    exit 1
  fi

  step="prune"
  prune_releases "${previous:+$ROTA_ROOT/$previous}"
  hc_ping HEALTHCHECKS_DEPLOY_URL "" "deployed $sha"
  log "deployed $sha"
}

main "$@"
