#!/bin/bash
# Builds a self-hosted release from the committed HEAD of this checkout into a
# staging directory, next to the live release. Runs as the Mac's own user; it
# never touches the live release or the services.
#
#   ops/macos/build-release.sh [staging-dir]
#
# Progress lines start with "STEP:" so the Mac host console can show them.
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lumapos_root="${LUMAPOS_ROOT:-/Users/Shared/LumaPOS}"
live_root="$lumapos_root/app"
staging_root="${1:-$lumapos_root/app-next}"
export PATH="$lumapos_root/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

step() { printf 'STEP:%s\n' "$1"; }

case "$staging_root" in
  "$lumapos_root"/app-next*) ;;
  *) echo "Staging directory must be $lumapos_root/app-next*" >&2; exit 64 ;;
esac

commit="$(git -C "$source_root" rev-parse HEAD)"
step "source $commit"

step "export"
rm -rf "$staging_root"
mkdir -p "$staging_root"
git -C "$source_root" archive HEAD | tar -x -C "$staging_root"
printf '%s\n' "$commit" > "$staging_root/RELEASE_COMMIT"

step "dependencies"
if [[ -d "$live_root/node_modules" ]] && cmp -s "$staging_root/bun.lock" "$live_root/bun.lock"; then
  # Same lockfile: an APFS clone of the live dependencies is instant.
  cp -Rc "$live_root/node_modules" "$staging_root/node_modules"
else
  (cd "$staging_root" && bun install --frozen-lockfile)
fi

step "build"
# The build only imports modules that require DATABASE_URL to be set; it never
# connects. The services read the real value from the protected runtime env.
(cd "$staging_root" && DATABASE_URL="postgres://build@127.0.0.1:1/build" NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build)

[[ -s "$staging_root/.next/BUILD_ID" ]] || { echo "Build produced no BUILD_ID" >&2; exit 1; }
step "built $commit"
