#!/bin/bash
# shellcheck source-path=SCRIPTDIR
# Entry point for the api and web LaunchDaemons, and for one-off commands:
#   rota-run.sh api | web | exec <scope> <command...>
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

service=${1:?usage: rota-run.sh api|web|exec <api|web> <command...>}
release=$(cd "$ROTA_ROOT/current" && pwd -P)

case $service in
  api)
    load_env api
    # Parallel run beside Railway: Railway still texts everyone, so the mini must
    # not run jobs or hold credentials that deliver. Refuse to start rather than double-text.
    if [[ ${ROTA_MODE:-} == parallel ]] &&
      [[ -n ${SOLID_QUEUE_IN_PUMA:-} || -n ${SIGNUP_ALERT_PHONE:-} || ${TWILIO_FROM_NUMBER:-} != +15005550006 ]]; then
      echo "ROTA_MODE=parallel needs SOLID_QUEUE_IN_PUMA and SIGNUP_ALERT_PHONE unset and Twilio test credentials (TWILIO_FROM_NUMBER=+15005550006)" >&2
      exit 78
    fi
    use_runtimes "$release"
    # Exported here, not in the plist: SIP strips DYLD_* from /bin/bash's
    # environment, and the exec chain below to ruby must not pass through
    # /usr/bin/env or any other protected binary. MALLOC_ARENA_MAX is glibc-only.
    if [[ -r $JEMALLOC_LIB ]]; then
      export DYLD_INSERT_LIBRARIES=$JEMALLOC_LIB MALLOC_CONF=narenas:2
    fi
    cd "$release/apps/api"
    exec ruby -S bundle exec puma -C config/puma.rb -b tcp://127.0.0.1:3000
    ;;
  web)
    load_env web
    use_runtimes "$release"
    export NODE_ENV=production
    cd "$release/apps/web"
    exec node node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1
    ;;
  exec)
    scope=${2:?usage: rota-run.sh exec <api|web> <command...>}
    shift 2
    load_env "$scope"
    use_runtimes "$release"
    cd "$release/apps/$scope"
    exec "$@"
    ;;
  *)
    echo "unknown service: $service" >&2
    exit 64
    ;;
esac
