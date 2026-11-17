#!/bin/bash
# Puts a release built by build-release.sh in place of the live one and
# restarts the services that run from it. Must run as root (the Mac host
# console runs it through the macOS administrator prompt).
#
#   sudo ops/macos/deploy-release.sh [staging-dir]
#
# If the web server does not answer /api/health/live afterwards, the previous
# release is put back and the script exits non-zero.
set -uo pipefail

lumapos_root="${LUMAPOS_ROOT:-/Users/Shared/LumaPOS}"
live_root="$lumapos_root/app"
staging_root="${1:-$lumapos_root/app-next}"
services=(web sync notifications)
keep_previous=2

step() { printf 'STEP:%s\n' "$1"; }
fail() { echo "$1" >&2; exit 1; }

[[ "$(id -u)" == 0 ]] || fail "deploy-release.sh must run as root"
case "$staging_root" in
  "$lumapos_root"/app-next*) ;;
  *) fail "Staging directory must be $lumapos_root/app-next*" ;;
esac
[[ -s "$staging_root/.next/BUILD_ID" ]] || fail "No built release in $staging_root"
for dotenv_file in .env .env.local .env.production .env.production.local; do
  [[ -e "$staging_root/$dotenv_file" ]] && fail "Release contains $dotenv_file"
done

stop_services() {
  for s in "${services[@]}"; do launchctl bootout "system/com.lumapos.$s" 2>/dev/null || true; done
  # bootout returns before launchd has finished; wait until the jobs are gone.
  for _ in $(seq 1 30); do
    local loaded=0
    for s in "${services[@]}"; do launchctl print "system/com.lumapos.$s" >/dev/null 2>&1 && loaded=1; done
    [[ $loaded == 0 ]] && return 0
    sleep 1
  done
}

start_services() {
  local failed=0
  for s in "${services[@]}"; do
    local ok=0
    for _ in $(seq 1 15); do
      if launchctl bootstrap system "/Library/LaunchDaemons/com.lumapos.$s.plist" 2>/dev/null \
        || launchctl print "system/com.lumapos.$s" >/dev/null 2>&1; then ok=1; break; fi
      sleep 2
    done
    [[ $ok == 1 ]] || { echo "Could not load com.lumapos.$s" >&2; failed=1; }
  done
  return $failed
}

wait_live() {
  for _ in $(seq 1 45); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health/live)" == 200 ]] && return 0
    sleep 2
  done
  return 1
}

previous="$lumapos_root/app-prev-$(date +%Y%m%d_%H%M%S)"

step "stop"
stop_services

step "swap"
mv "$live_root" "$previous" || { start_services; fail "Could not move the live release aside"; }
mv "$staging_root" "$live_root" || { mv "$previous" "$live_root"; start_services; fail "Could not move the new release in"; }
mkdir -p "$live_root/.next/cache"
chown -R _lumapos_svc:staff "$live_root/.next/cache"

step "start"
if start_services && wait_live; then
  step "live"
  # Keep the newest previous releases for a manual rollback.
  ls -1d "$lumapos_root"/app-prev-* 2>/dev/null | sort -r | tail -n +$((keep_previous + 1)) | while read -r old; do rm -rf "$old"; done
  exit 0
fi

step "rollback"
stop_services
failed_release="$lumapos_root/app-failed-$(date +%Y%m%d_%H%M%S)"
mv "$live_root" "$failed_release"
mv "$previous" "$live_root"
start_services
wait_live
fail "The new release did not come up; the previous release is running again (failed release kept at $failed_release)"
