#!/bin/bash
# shellcheck source-path=SCRIPTDIR
# Nightly pg_dump of the primary database, age-encrypted, copied to R2. Run as rota
# by monster.rota.backup. Retention is the bucket's lifecycle rule, not this script.
# Reads only backup.env: the dump needs the database password and R2, nothing else.
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# An empty or schema-only database dumps to a few KB; a real one is far larger.
MIN_DUMP_BYTES=${MIN_DUMP_BYTES:-16384}

step="load env"
name=
workdir=
env_ok=1
load_env_file "$ROTA_ENV_DIR/backup.env" || env_ok=0

# Set before any check, so a missing setting pings /fail instead of waiting out the grace period.
on_exit() {
  local status=$?
  [[ -n $workdir ]] && rm -rf "$workdir"
  if [[ $status -ne 0 ]]; then
    hc_ping HEALTHCHECKS_BACKUP_URL /fail "backup ${name:-?} failed at '$step' (exit $status); see $ROTA_ROOT/log/backup.log"
  fi
}
trap on_exit EXIT

if [[ $env_ok == 0 ]]; then
  log "cannot read $ROTA_ENV_DIR/backup.env"
  exit 1
fi
step="check settings"
for var in BACKUP_AGE_RECIPIENT BACKUP_R2_DEST HOUSEROTA_API_DATABASE_PASSWORD; do
  if [[ -z ${!var:-} ]]; then
    log "$var is not set in $ROTA_ENV_DIR/backup.env"
    exit 1
  fi
done

db=houserota_api_production
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="$db-$stamp.dump.age"
workdir=$(mktemp -d "${TMPDIR:-/tmp}/rota-backup.XXXXXX")

hc_ping HEALTHCHECKS_BACKUP_URL /start ""

# Encrypted before it touches disk. Written whole, then copied, so a dump that dies
# halfway never lands in the bucket under a name that looks good.
step="pg_dump"
PGPASSWORD=$HOUSEROTA_API_DATABASE_PASSWORD pg_dump -Fc -U houserota_api "$db" |
  age -r "$BACKUP_AGE_RECIPIENT" -o "$workdir/$name"

size=$(stat -f %z "$workdir/$name")
if ((size < MIN_DUMP_BYTES)); then
  log "$name is $size bytes, under the $MIN_DUMP_BYTES-byte floor; not uploading"
  exit 1
fi

step="upload"
rclone copyto --s3-no-check-bucket "$workdir/$name" "$BACKUP_R2_DEST/$name"

log "uploaded $name ($size bytes)"
hc_ping HEALTHCHECKS_BACKUP_URL "" "uploaded $name ($size bytes)"
