#!/bin/bash
# shellcheck source-path=SCRIPTDIR
# Nightly pg_dump of the primary database, age-encrypted, copied to R2. Run as rota
# by monster.rota.backup. Retention is the bucket's lifecycle rule, not this script.
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_env ""

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"
: "${BACKUP_R2_DEST:?BACKUP_R2_DEST is not set (e.g. r2:rota-backups/primary)}"
: "${HOUSEROTA_API_DATABASE_PASSWORD:?HOUSEROTA_API_DATABASE_PASSWORD is not set}"

db=houserota_api_production
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="$db-$stamp.dump.age"
workdir=$(mktemp -d "${TMPDIR:-/tmp}/rota-backup.XXXXXX")
trap 'rm -rf "$workdir"' EXIT
trap 'hc_ping HEALTHCHECKS_BACKUP_URL /fail "backup $name failed at line $LINENO"' ERR

hc_ping HEALTHCHECKS_BACKUP_URL /start ""

# Encrypted before it touches disk. Written whole, then copied, so a dump that dies
# halfway never lands in the bucket under a name that looks good.
PGPASSWORD=$HOUSEROTA_API_DATABASE_PASSWORD pg_dump -Fc -U houserota_api "$db" |
  age -r "$BACKUP_AGE_RECIPIENT" -o "$workdir/$name"

size=$(stat -f %z "$workdir/$name")
rclone copyto --s3-no-check-bucket "$workdir/$name" "$BACKUP_R2_DEST/$name"

log "uploaded $name ($size bytes)"
hc_ping HEALTHCHECKS_BACKUP_URL "" "uploaded $name ($size bytes)"
