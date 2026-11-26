#!/bin/bash
# One-time switch of the store Mac from the classic layout (services run from
# /Users/Shared/LumaPOS/app, PostgreSQL from Homebrew under the Mac user) to
# the packaged install (runtime/<version>, bundled PostgreSQL as _lumapos_db).
# See docs/mac-host-installer-plan.md, phase 4.2.
#
#   sudo bash ops/macos/convert-classic-to-packaged.sh <mac-user> <runtime.tar.gz> <sha256> [--check]
#   --check runs only step 1 and changes nothing.
#   (or through the macOS administrator prompt; SUDO_USER must not be set,
#   because it runs `lumapos-admin bootstrap`)
#
# Order:
#   1  checks (classic layout, no packaged install yet, Homebrew PostgreSQL
#      answering, no backup in progress, disk space, runtime checksum)
#   2  bootstrap helper v8 (accounts, sudoers), install + activate the runtime
#   3  runtime.env for the packaged services from the classic env file
#   4  stop the classic services (the tunnel too: devices queue their sales)
#   5  row counts of every public table, then export-store from the classic
#      release (same archive as the Drive backups)
#   6  stop Homebrew PostgreSQL, init-database, restore the export, compare
#      the row counts
#   7  move the classic launchd definitions aside, start-services, check the
#      local and public health endpoints
# Any failure before the end puts the classic layout back: the Homebrew
# database is never written to, the classic media folder is only renamed,
# and the classic plists are kept.
#
# Kept for rollback by hand: media.classic-<ts>, classic-launchd-<ts>/,
# secrets/runtime.env.before-packaged-<ts>, the Homebrew data directory and
# backups/pre-packaged-<ts>.lumaenc.
set -uo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

readonly R=/Users/Shared/LumaPOS
readonly TS="$(date +%Y%m%d_%H%M%S)"
readonly LOG="$R/logs/convert-$TS.log"
readonly HELPER=/usr/local/libexec/lumapos-admin
readonly SVC=_lumapos_svc
readonly CLASSIC_ENV="$R/secrets/runtime.local-restored.env"
readonly PACKAGED_ENV="$R/secrets/runtime.env"
readonly BREW_PG_BIN=/opt/homebrew/opt/postgresql@17/bin
readonly CLASSIC_SERVICES=(cloudflared web sync notifications backups)
readonly BREW_PG_LABEL=sh.brew.postgresql@17

user="${1:-}" runtime="${2:-}" sha="${3:-}" mode="${4:-}"
helper_source="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lumapos-admin"

exec > >(tee -a "$LOG") 2>&1
step() { printf '== %s %s\n' "$(date +%H:%M:%S)" "$1"; }
die() { printf 'FAILED: %s\n' "$1"; exit 1; }

[[ "$(id -u)" == 0 ]] || die "Run as root"
[[ -z "${SUDO_USER:-}" ]] || die "Run through the administrator prompt or 'sudo -i', not plain sudo (bootstrap refuses SUDO_USER)"
[[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] && id "$user" >/dev/null 2>&1 || die "Unknown Mac user: $user"
uid="$(id -u "$user")"
brew_pg_plist="$(eval echo "~$user")/Library/LaunchAgents/$BREW_PG_LABEL.plist"
name="$(basename "$runtime")"
[[ "$name" =~ ^lumapos-runtime-([0-9]{8}\.[0-9]{6}-[0-9a-f]{8})\.tar\.gz$ ]] || die "Unexpected runtime name: $name"
version="${BASH_REMATCH[1]}"
[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "Pass the runtime SHA-256"

as_user() { sudo -u "$user" -H -- "$@"; }
classic_psql() { as_user "$BREW_PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -d lumapos_prod "$@"; }
packaged_psql() { sudo -u _lumapos_db -- "$R/current/postgresql-17/bin/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$R/postgres/run" -p 5432 -d lumapos_prod "$@"; }
http_code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$1"; }
count_rows() {
  # Every public table except the backup history, which the archive leaves out.
  "$1" -c "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'database_backup_runs'" \
    | "$1" | sort
}

# ---- rollback ----

stage=checks
media_moved="" plists_moved="" brew_stopped="" classic_stopped=""
rollback() {
  step "ROLLBACK from stage $stage"
  local n
  # Whatever runs under com.lumapos.* once the classic services are stopped
  # is packaged; before that, only the packaged PostgreSQL can be running.
  launchctl bootout system/com.lumapos.postgres 2>/dev/null || true
  if [[ -n "$classic_stopped" ]]; then
    for n in "${CLASSIC_SERVICES[@]}"; do launchctl bootout "system/com.lumapos.$n" 2>/dev/null || true; done
  fi
  if [[ -n "$plists_moved" ]]; then
    for n in "${CLASSIC_SERVICES[@]}"; do
      rm -f "/Library/LaunchDaemons/com.lumapos.$n.plist"
      cp -p "$plists_moved/com.lumapos.$n.plist" "/Library/LaunchDaemons/com.lumapos.$n.plist"
    done
  fi
  rm -f /Library/LaunchDaemons/com.lumapos.postgres.plist
  if [[ -n "$media_moved" && -d "$media_moved" ]]; then
    mv "$R/media" "$R/media.packaged-failed-$TS" 2>/dev/null || true
    mv "$media_moved" "$R/media"
  fi
  if [[ -n "$brew_stopped" ]]; then
    launchctl enable "gui/$uid/$BREW_PG_LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$uid" "$brew_pg_plist" 2>/dev/null || true
    for _ in $(seq 1 30); do classic_psql -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
  fi
  [[ -L "$R/current" ]] && mv "$R/current" "$R/current.failed-$TS"
  if [[ -n "$classic_stopped" ]]; then
    for n in "${CLASSIC_SERVICES[@]}"; do
      launchctl enable "system/com.lumapos.$n" 2>/dev/null || true
      launchctl bootstrap system "/Library/LaunchDaemons/com.lumapos.$n.plist" 2>/dev/null || true
    done
  fi
  for _ in $(seq 1 45); do [[ "$(http_code http://127.0.0.1:3000/api/health/live)" == 200 ]] && break; sleep 2; done
  step "classic layout back: live=$(http_code http://127.0.0.1:3000/api/health/live) public=$(http_code https://pos.haidangshop.com/api/health/live)"
  exit 1
}
fail_back() { printf 'FAILED: %s\n' "$1"; rollback; }

# ---- 1. checks ----

step "checks (log: $LOG)"
[[ ! -e "$R/current" ]] || die "A packaged install already exists ($R/current)"
for n in "${CLASSIC_SERVICES[@]}"; do
  plutil -extract ProgramArguments.1 raw -o - "/Library/LaunchDaemons/com.lumapos.$n.plist" 2>/dev/null | grep -q -e "$R/app/" -e cloudflared \
    || [[ "$n" == cloudflared ]] || die "com.lumapos.$n is not a classic definition"
done
[[ -f "$CLASSIC_ENV" ]] || die "Missing $CLASSIC_ENV"
grep -q '^tunnel: ' "$R/secrets/cloudflared.yml" || die "cloudflared.yml has no tunnel line"
classic_psql -c 'select 1' >/dev/null || die "Homebrew PostgreSQL does not answer"
[[ -f "$brew_pg_plist" ]] || die "Missing $brew_pg_plist"
[[ -z "$(ls -A "$R/backup-staging" 2>/dev/null)" ]] || die "backup-staging is not empty (a backup may be running)"
[[ -f "$runtime" ]] || die "Missing $runtime"
[[ "$(shasum -a 256 "$runtime" | awk '{print $1}')" == "$sha" ]] || die "Runtime checksum does not match"
free_kb="$(df -k "$R" | awk 'NR == 2 { print $4 }')"
(( free_kb > 10 * 1024 * 1024 )) || die "Less than 10 GB free"
[[ "$(http_code http://127.0.0.1:3000/api/health/live)" == 200 ]] || die "The classic web server is not healthy before the switch"
bash -n "$helper_source" || die "Helper source does not parse"
step "checks passed (runtime $version, user $user)"
if [[ "$mode" == --check ]]; then
  step "classic tables: $(classic_psql -c "select count(*) from pg_tables where schemaname = 'public'") public tables"
  exit 0
fi

# ---- 2. helper and runtime ----

stage=helper
/bin/bash "$helper_source" bootstrap "$user" || die "bootstrap failed"
"$HELPER" version | grep -qx 8 || die "Helper v8 is not installed"
"$HELPER" install-runtime "$runtime" "$sha" || die "install-runtime failed"
stage=runtime
"$HELPER" activate-runtime "$version" || fail_back "activate-runtime failed"
[[ "$(readlink "$R/current")" == "runtime/$version" || "$(readlink "$R/current")" == "$R/runtime/$version" ]] || fail_back "current does not point at $version"

# ---- 3. runtime.env ----

stage=env
[[ -f "$PACKAGED_ENV" ]] && cp -p "$PACKAGED_ENV" "$PACKAGED_ENV.before-packaged-$TS"
tmp="$(mktemp "$R/secrets/.runtime.env.XXXXXX")" || fail_back "mktemp failed"
# Last value of every key wins (the classic file repeats some blocks); keys
# that point at the classic tools or database are dropped: the plists set the
# bundled tools and init-database writes the database URLs.
awk '
  /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/ {
    line = $0; sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
    key = line; sub(/=.*/, "", key)
    if (key ~ /^(DATABASE_URL|MIGRATION_DATABASE_URL|LUMAPOS_RCLONE_BIN|LUMAPOS_POSTGRES_BIN_DIR|LUMAPOS_BUN_BIN)$/) next
    if (!(key in seen)) order[++n] = key
    seen[key] = 1; value[key] = line
  }
  END { for (i = 1; i <= n; i++) print value[order[i]] }
' "$CLASSIC_ENV" > "$tmp" || fail_back "Could not build runtime.env"
chown "$SVC:staff" "$tmp" && chmod 0600 "$tmp" && mv -f "$tmp" "$PACKAGED_ENV" || fail_back "Could not install runtime.env"
step "runtime.env: $(wc -l < "$PACKAGED_ENV" | tr -d ' ') keys"

# ---- 4. stop the classic services ----

stage=stop
classic_stopped=1
for n in "${CLASSIC_SERVICES[@]}"; do launchctl bootout "system/com.lumapos.$n" 2>/dev/null || true; done
for _ in $(seq 1 60); do
  busy=0
  for n in "${CLASSIC_SERVICES[@]}"; do launchctl print "system/com.lumapos.$n" >/dev/null 2>&1 && busy=1; done
  [[ $busy == 0 ]] && break
  sleep 1
done
[[ $busy == 0 ]] || fail_back "Classic services did not stop"
step "classic services stopped"

# ---- 5. counts and export ----

stage=export
count_rows classic_psql > "$R/logs/convert-$TS.counts-classic" || fail_back "Could not count the classic rows"
step "counted $(wc -l < "$R/logs/convert-$TS.counts-classic" | tr -d ' ') tables"
export_output="$(sudo -u "$SVC" -- /usr/bin/env -i \
  PATH="$R/bin:$BREW_PG_BIN:/usr/bin:/bin" TMPDIR="$R/backup-staging/" \
  LUMAPOS_APP_ROOT="$R/app" LUMAPOS_ENV_FILE="$CLASSIC_ENV" LUMAPOS_BUN_BIN="$R/bin/bun" \
  LUMAPOS_POSTGRES_BIN_DIR="$BREW_PG_BIN" \
  /bin/bash "$R/app/ops/shared/run-service.sh" export-store)" || fail_back "export-store failed"
archive="$(printf '%s\n' "$export_output" | sed -n 's/.*"archiveName":"\(lumapos-[0-9a-f-]*\.lumaenc\)".*/\1/p' | tail -n 1)"
[[ -n "$archive" && -f "$R/backup-staging/$archive" ]] || fail_back "No export archive"
mkdir -p "$R/backups"
safe_copy="$R/backups/pre-packaged-$TS.lumaenc"
cp -p "$R/backup-staging/$archive" "$safe_copy" && chown "$SVC:staff" "$safe_copy" && chmod 0600 "$safe_copy" \
  || fail_back "Could not keep a copy of the export"
step "exported $(du -h "$safe_copy" | cut -f1) to $safe_copy"

# ---- 6. bundled PostgreSQL and restore ----

stage=database
brew_stopped=1
# Stopped and disabled in the user's launchd domain, so it does not start
# again at the next login and take port 5432; the data directory stays.
launchctl bootout "gui/$uid/$BREW_PG_LABEL" 2>/dev/null
launchctl disable "gui/$uid/$BREW_PG_LABEL" || fail_back "Could not disable Homebrew PostgreSQL"
for _ in $(seq 1 30); do lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1 && fail_back "Port 5432 is still in use"
"$HELPER" init-database || fail_back "init-database failed"
"$HELPER" init-runtime-env || fail_back "init-runtime-env failed"

stage=restore
media_moved="$R/media.classic-$TS"
mv "$R/media" "$media_moved" || { media_moved=""; fail_back "Could not move the classic media aside"; }
install -d -o "$SVC" -g staff -m 0700 "$R/media" || fail_back "Could not create the media folder"
"$HELPER" restore-file "$safe_copy" || fail_back "restore-file failed"
rm -f "$R/backup-staging/$archive"
count_rows packaged_psql > "$R/logs/convert-$TS.counts-packaged" || fail_back "Could not count the restored rows"
if ! diff -q "$R/logs/convert-$TS.counts-classic" "$R/logs/convert-$TS.counts-packaged" >/dev/null; then
  diff "$R/logs/convert-$TS.counts-classic" "$R/logs/convert-$TS.counts-packaged" | head -20
  fail_back "Row counts differ after the restore"
fi
classic_files="$(find "$media_moved" -type f | wc -l | tr -d ' ')"
packaged_files="$(find "$R/media" -type f | wc -l | tr -d ' ')"
[[ "$classic_files" == "$packaged_files" ]] || fail_back "Media files differ ($classic_files vs $packaged_files)"
step "restored: row counts match, $packaged_files media files"

# ---- 7. packaged services ----

stage=services
plists_moved="$R/classic-launchd-$TS"
mkdir -p "$plists_moved"
for n in "${CLASSIC_SERVICES[@]}"; do
  cp -p "/Library/LaunchDaemons/com.lumapos.$n.plist" "$plists_moved/" && rm -f "/Library/LaunchDaemons/com.lumapos.$n.plist" \
    || fail_back "Could not move com.lumapos.$n aside"
done
"$HELPER" start-services || fail_back "start-services failed"
for _ in $(seq 1 30); do [[ "$(http_code https://pos.haidangshop.com/api/health/live)" == 200 ]] && break; sleep 2; done
live="$(http_code http://127.0.0.1:3000/api/health/live)"
public="$(http_code https://pos.haidangshop.com/api/health/live)"
[[ "$live" == 200 && "$public" == 200 ]] || fail_back "Health after the switch: local $live, public $public"

stage=done
"$HELPER" status
step "DONE: packaged runtime $version is live (local $live, public $public)"
step "kept for rollback: $media_moved, $plists_moved, $safe_copy, Homebrew data (brew services stopped)"
