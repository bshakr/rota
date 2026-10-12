# shellcheck shell=bash
# Shared by rota-run.sh, deploy.sh and backup.sh. Sourced, never executed.

ROTA_ROOT="${ROTA_ROOT:-/opt/rota}"
ROTA_ENV_DIR="${ROTA_ENV_DIR:-/usr/local/etc/rota}"
ROTA_REPO="${ROTA_REPO:-$ROTA_ROOT/repo}"
# CI builds and tests with Node 22 (.github/workflows/ci.yml); the repo-root
# .tool-versions pins 25 for development, so production follows CI.
NODE_VERSION="${NODE_VERSION:-22}"
PG_BIN=/opt/homebrew/opt/postgresql@16/bin
# shellcheck disable=SC2034 # read by rota-run.sh
JEMALLOC_LIB=/opt/homebrew/opt/jemalloc/lib/libjemalloc.2.dylib

export PATH="$PG_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# KEY=value per line, value taken literally (no quotes, no expansion), so the
# file is data and never run as shell. Values are never printed.
load_env_file() {
  local file=$1 line key n=0
  [[ -r $file ]] || return 1
  while IFS= read -r line || [[ -n $line ]]; do
    n=$((n + 1))
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    key=${line%%=*}
    if [[ $line != *=* || ! $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      log "ignoring malformed line $n of $file"
      continue
    fi
    export "$key=${line#*=}"
  done <"$file"
}

# Shared file first, then the optional per-service file, which wins.
load_env() {
  local scope=$1
  if ! load_env_file "$ROTA_ENV_DIR/env"; then
    if [[ ${DRY_RUN:-0} == 1 ]]; then
      log "dry run: $ROTA_ENV_DIR/env not readable, continuing without it"
    else
      log "cannot read $ROTA_ENV_DIR/env"
      return 1
    fi
  fi
  if [[ -n $scope && -e $ROTA_ENV_DIR/$scope.env ]]; then
    load_env_file "$ROTA_ENV_DIR/$scope.env"
  fi
}

# Absolute install paths, not mise shims or activation: a release dir carries the
# repo's .tool-versions, and shims are scripts that would drop DYLD_* under SIP.
use_runtimes() {
  local release=$1 ruby_version ruby_home node_home
  ruby_version=$(<"$release/apps/api/.ruby-version")
  ruby_home=$(mise where "ruby@$ruby_version") || return 1
  node_home=$(mise where "node@$NODE_VERSION") || return 1
  export PATH="$ruby_home/bin:$node_home/bin:$PATH"
  export RAILS_ENV=production TZ=UTC
  export BUNDLE_PATH="$ROTA_ROOT/shared/bundle" BUNDLE_DEPLOYMENT=1 BUNDLE_WITHOUT=development:test
  if [[ -r $release/REVISION ]]; then
    SENTRY_RELEASE=$(<"$release/REVISION")
    export SENTRY_RELEASE
  fi
}

# Healthchecks.io: $1 is the env var holding the check URL, $2 "" or "/fail", $3 the log line.
hc_ping() {
  local url=${!1:-} suffix=$2 body=${3:-}
  if [[ -z $url ]]; then
    log "$1 not set, skipping ping"
    return 0
  fi
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$body" "$url$suffix" || log "healthchecks ping failed"
}
