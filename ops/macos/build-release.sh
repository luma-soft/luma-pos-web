#!/bin/bash
# Builds a self-hosted release from the committed HEAD of this checkout into a
# staging directory, next to the live release. Runs as the Mac's own user; it
# never touches the live release or the services.
#
#   ops/macos/build-release.sh [staging-dir]
#
# Layouts (LUMAPOS_RELEASE_LAYOUT):
#   runtime (default)  Next.js standalone server at the release root plus
#                      bundled workers; no source tree and no full
#                      node_modules. Built in a persistent workspace
#                      ($LUMAPOS_ROOT/app-build) that keeps node_modules.
#   classic            The whole source tree with node_modules, started with
#                      `bun run …` (the layout used before 2026-11-24).
#
# Both layouts keep .next/BUILD_ID, .next/cache and ops/shared/run-service.sh
# where `lumapos-admin deploy` checks for them.
#
# Progress lines start with "STEP:" so the Mac host console can show them.
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lumapos_root="${LUMAPOS_ROOT:-/Users/Shared/LumaPOS}"
live_root="$lumapos_root/app"
staging_root="${1:-$lumapos_root/app-next}"
layout="${LUMAPOS_RELEASE_LAYOUT:-runtime}"
export PATH="$lumapos_root/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NEXT_TELEMETRY_DISABLED=1

step() { printf 'STEP:%s\n' "$1"; }

case "$staging_root" in
  "$lumapos_root"/app-next*) ;;
  *) echo "Staging directory must be $lumapos_root/app-next*" >&2; exit 64 ;;
esac
case "$layout" in
  runtime|classic) ;;
  *) echo "LUMAPOS_RELEASE_LAYOUT must be runtime or classic" >&2; exit 64 ;;
esac

# The build only imports modules that require DATABASE_URL to be set; it never
# connects. The services read the real value from the protected runtime env.
build_env=(DATABASE_URL="postgres://build@127.0.0.1:1/build")

commit="$(git -C "$source_root" rev-parse HEAD)"
step "source $commit"

if [[ "$layout" == classic ]]; then
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
  (cd "$staging_root" && env "${build_env[@]}" ./node_modules/.bin/next build)
  [[ -s "$staging_root/.next/BUILD_ID" ]] || { echo "Build produced no BUILD_ID" >&2; exit 1; }
  step "built $commit"
  exit 0
fi

# ---- runtime layout --------------------------------------------------------

workspace="$lumapos_root/app-build"
installed_lock="$workspace/.installed-bun.lock"

step "export"
mkdir -p "$workspace"
# Keep node_modules (and the lockfile it was installed from) between builds.
find "$workspace" -mindepth 1 -maxdepth 1 \
  ! -name node_modules ! -name "$(basename "$installed_lock")" -exec rm -rf {} +
git -C "$source_root" archive HEAD | tar -x -C "$workspace"

step "dependencies"
if [[ ! -d "$workspace/node_modules" && -d "$live_root/node_modules" && -f "$live_root/bun.lock" ]] \
  && [[ ! -f "$live_root/server.js" ]] && cmp -s "$workspace/bun.lock" "$live_root/bun.lock"; then
  # First runtime build next to a classic release with the same lockfile.
  cp -Rc "$live_root/node_modules" "$workspace/node_modules"
  cp "$workspace/bun.lock" "$installed_lock"
fi
if [[ ! -d "$workspace/node_modules" ]] || ! cmp -s "$workspace/bun.lock" "$installed_lock"; then
  (cd "$workspace" && bun install --frozen-lockfile)
  cp "$workspace/bun.lock" "$installed_lock"
fi

step "build"
(cd "$workspace" && env "${build_env[@]}" LUMAPOS_NEXT_OUTPUT=standalone ./node_modules/.bin/next build)
[[ -s "$workspace/.next/BUILD_ID" && -f "$workspace/.next/standalone/server.js" ]] \
  || { echo "Build produced no standalone server" >&2; exit 1; }

step "workers"
workers_out="$workspace/.lumapos-workers"
rm -rf "$workers_out"
# Long-running and one-shot backend commands, bundled for the shared Bun
# binary. @opentelemetry/api is an optional require inside Next.js.
worker_sources=(
  src/scripts/process-sync-events.ts
  src/scripts/process-notification-outbox.ts
  src/scripts/run-database-backups.ts
  src/scripts/restore-database-backup.ts
  src/scripts/run-self-hosted-maintenance.ts
  src/db/apply-migrations-from-database-url.ts
  src/scripts/provision-store.ts
  src/scripts/list-drive-backups.ts
)
for source in "${worker_sources[@]}"; do
  name="$(basename "$source" .ts)"
  (cd "$workspace" && bun build "$source" --target=bun --conditions=react-server \
    --external @opentelemetry/api --outdir "$workers_out/$name")
  [[ -s "$workers_out/$name/$name.js" ]] || { echo "Worker bundle $name is missing" >&2; exit 1; }
done

step "assemble"
rm -rf "$staging_root"
mkdir -p "$staging_root"
# Standalone server at the root: server.js, package.json, .next, traced node_modules.
cp -Rc "$workspace/.next/standalone/." "$staging_root/"
# Next.js does not copy static assets into the standalone output.
mkdir -p "$staging_root/.next"
cp -Rc "$workspace/.next/static" "$staging_root/.next/static"
cp -Rc "$workspace/public" "$staging_root/public"
mkdir -p "$staging_root/workers" "$staging_root/ops/shared"
for dir in "$workers_out"/*; do
  cp -c "$dir/$(basename "$dir").js" "$staging_root/workers/"
done
# Migrations are read from ./drizzle relative to the working directory.
cp -Rc "$workspace/drizzle" "$staging_root/drizzle"
cp -c "$workspace/ops/shared/run-service.sh" "$staging_root/ops/shared/run-service.sh"
# SQL that `lumapos-admin migrate` runs around the migrations (packaged layout).
mkdir -p "$staging_root/sql"
cp -c "$workspace/scripts/bootstrap-local-postgres-compat.sql" "$workspace/scripts/grant-self-hosted-runtime-role.sql" "$staging_root/sql/"
rm -rf "$staging_root/.next/cache"
for dotenv in .env .env.local .env.production .env.production.local; do
  rm -f "$staging_root/$dotenv"
done
printf '%s\n' "$commit" > "$staging_root/RELEASE_COMMIT"

step "manifest"
version="$(date -u +%Y%m%d.%H%M%S)-${commit:0:8}"
bun_version="$(bun --version)"
(
  cd "$staging_root"
  {
    printf '{\n'
    printf '  "format": 1,\n'
    printf '  "layout": "runtime",\n'
    printf '  "version": "%s",\n' "$version"
    printf '  "commit": "%s",\n' "$commit"
    printf '  "builtAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "platform": "darwin-arm64",\n'
    printf '  "bun": "%s",\n' "$bun_version"
    printf '  "postgresMajor": 17,\n'
    printf '  "files": {\n'
    find . -type f ! -name manifest.json ! -path './.next/cache/*' -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 shasum -a 256 \
      | awk 'BEGIN { first = 1 }
          { path = substr($0, index($0, "  ") + 2); sub(/^\.\//, "", path)
            gsub(/\\/, "\\\\", path); gsub(/"/, "\\\"", path)
            printf "%s    \"%s\": \"%s\"", (first ? "" : ",\n"), path, $1; first = 0 }
          END { printf "\n" }'
    printf '  }\n'
    printf '}\n'
  } > manifest.json
)

step "built $commit ($(du -sh "$staging_root" | cut -f1))"
