#!/usr/bin/env bash
set -Eeuo pipefail

for name in SESSION_DATABASE_URL; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required backup setting: ${name}" >&2
    exit 1
  fi
done

# A killed runner must not leave the singleton queue locked forever.
psql "$SESSION_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  UPDATE public.database_backup_runs
  SET status = 'failed', finished_at = clock_timestamp(), failure_code = 'worker_timeout'
  WHERE status = 'running' AND started_at < clock_timestamp() - interval '45 minutes';
" >/dev/null

RUN_ID="$(psql "$SESSION_DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -c "
  WITH next_job AS (
    SELECT id
    FROM public.database_backup_runs
    WHERE status = 'queued'
    ORDER BY requested_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.database_backup_runs AS run
  SET status = 'running', started_at = clock_timestamp(), finished_at = NULL,
      duration_milliseconds = NULL, failure_code = NULL
  FROM next_job
  WHERE run.id = next_job.id
  RETURNING run.id;
")"

if [[ -z "$RUN_ID" ]]; then
  echo "No database backup is queued."
  exit 0
fi

STARTED_AT_MS="$(date +%s%3N)"
FAILURE_CODE=backup_failed
WORK_DIR="$(mktemp -d)"

mark_failed() {
  local exit_status=$?
  trap - ERR
  psql "$SESSION_DATABASE_URL" -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" \
    -v failure_code="$FAILURE_CODE" -q <<'SQL' >/dev/null || true
UPDATE public.database_backup_runs
SET status = 'failed', finished_at = clock_timestamp(),
    duration_milliseconds = greatest(0, floor(extract(epoch from (clock_timestamp() - started_at)) * 1000)::integer),
    failure_code = :'failure_code'
WHERE id = :'run_id'::uuid AND status = 'running';
SQL
  rm -rf "$WORK_DIR"
  exit "$exit_status"
}
trap mark_failed ERR
trap 'rm -rf "$WORK_DIR"' EXIT

for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_PRIVATE_BUCKET; do
  if [[ -z "${!name:-}" ]]; then
    FAILURE_CODE=configuration_missing
    echo "Missing required backup setting: ${name}" >&2
    exit 1
  fi
done

if [[ ! "$R2_ACCOUNT_ID" =~ ^[0-9a-fA-F]{32}$ ]]; then
  FAILURE_CODE=configuration_invalid
  echo "R2_ACCOUNT_ID is invalid" >&2
  exit 1
fi
if [[ ! "$R2_PRIVATE_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]]; then
  FAILURE_CODE=configuration_invalid
  echo "R2_PRIVATE_BUCKET is invalid" >&2
  exit 1
fi

export RCLONE_CONFIG_BACKUPS_TYPE=s3
export RCLONE_CONFIG_BACKUPS_PROVIDER=Cloudflare
export RCLONE_CONFIG_BACKUPS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_BACKUPS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_BACKUPS_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_BACKUPS_REGION=auto
export RCLONE_CONFIG_BACKUPS_ACL=private

cd "$WORK_DIR"
umask 077

supabase db dump --remote="$SESSION_DATABASE_URL" -f roles.sql --role-only
supabase db dump --remote="$SESSION_DATABASE_URL" -f schema.sql
supabase db dump --remote="$SESSION_DATABASE_URL" -f data.sql --data-only --use-copy \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes" \
  -x "public.database_backup_runs"

FAILURE_CODE=upload_failed
BACKUP_DATE="$(TZ=Asia/Ho_Chi_Minh date +%Y/%m/%d)"
ARCHIVE_KEY="database-backups/${BACKUP_DATE}/${RUN_ID}.tar.gz"

python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

names = ["roles.sql", "schema.sql", "data.sql"]
files = []
for name in names:
    path = Path(name)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    files.append({"name": name, "sizeBytes": path.stat().st_size, "sha256": digest})

manifest = {
    "format": "supabase-cli-logical",
    "included": [
        "PostgreSQL role definitions",
        "Application schema and table definitions",
        "Application data, including Supabase Auth user emails and password hashes emitted by the CLI data dump",
    ],
    "excluded": [
        "Database backup history row for this run",
        "Cloudflare R2 image and file contents",
        "Supabase-managed schema definitions and extension-owned objects",
    ],
    "files": files,
}
Path("manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n")
PY

tar -czf backup.tar.gz roles.sql schema.sql data.sql manifest.json
ARCHIVE_SIZE_BYTES="$(stat -c '%s' backup.tar.gz)"
ARCHIVE_SHA256="$(sha256sum backup.tar.gz | cut -d ' ' -f 1)"

rclone copyto "backup.tar.gz" "backups:${R2_PRIVATE_BUCKET}/${ARCHIVE_KEY}" --retries 3 --low-level-retries 10
rclone copyto "manifest.json" "backups:${R2_PRIVATE_BUCKET}/${ARCHIVE_KEY%.tar.gz}.manifest.json" --retries 3 --low-level-retries 10

FAILURE_CODE=history_update_failed
MANIFEST_JSON="$(python3 -c 'import json; print(json.dumps(json.load(open("manifest.json")), separators=(",", ":")))')"
DURATION_MS="$(( $(date +%s%3N) - STARTED_AT_MS ))"
psql "$SESSION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v run_id="$RUN_ID" \
  -v archive_key="$ARCHIVE_KEY" \
  -v archive_size_bytes="$ARCHIVE_SIZE_BYTES" \
  -v sha256="$ARCHIVE_SHA256" \
  -v duration_ms="$DURATION_MS" \
  -v manifest="$MANIFEST_JSON" \
  -q <<'SQL' >/dev/null
UPDATE public.database_backup_runs
SET status = 'succeeded', finished_at = clock_timestamp(),
    duration_milliseconds = :'duration_ms'::integer,
    archive_key = :'archive_key', archive_size_bytes = :'archive_size_bytes'::bigint,
    sha256 = :'sha256', manifest = :'manifest'::jsonb, failure_code = NULL
WHERE id = :'run_id'::uuid AND status = 'running';
SQL

trap - ERR
echo "Database backup completed: ${RUN_ID} (${ARCHIVE_SIZE_BYTES} bytes)."
