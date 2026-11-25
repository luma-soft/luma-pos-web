#!/bin/bash
# Assembles a LumaPOS runtime package from a runtime-layout web release
# (build-release.sh), the relocatable PostgreSQL (build-postgres.sh) and the
# tools bundle (build-tools-bundle.sh).
#
#   ops/macos/assemble-runtime.sh [release-dir]
#
# release-dir defaults to the live release /Users/Shared/LumaPOS/app; it must
# contain the runtime layout's manifest.json.
#
# Output in $LUMAPOS_BUILD_ROOT:
#   lumapos-runtime-<version>/          app/  postgresql-17/  tools/bin/  manifest.json
#   lumapos-runtime-<version>.tar.gz    and .sha256
#
# manifest.json lists every file with its SHA-256; `lumapos-admin
# install-runtime` checks it before a runtime can be activated. Signing the
# package (EdDSA) belongs to the release step (phase 5).
set -euo pipefail

build_root="${LUMAPOS_BUILD_ROOT:-$HOME/Library/Caches/LumaPOS/runtime-build}"
release_dir="${1:-/Users/Shared/LumaPOS/app}"
postgres_version="${LUMAPOS_POSTGRES_VERSION:-17.11}"
postgres_major="${postgres_version%%.*}"
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

step() { printf 'STEP:%s\n' "$1"; }
json_value() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null; }

release_manifest="$release_dir/manifest.json"
[[ -f "$release_manifest" && "$(json_value "$release_manifest" layout)" == runtime ]] \
  || { echo "$release_dir is not a runtime-layout release" >&2; exit 64; }
postgres_dir="$build_root/postgres-$postgres_version-darwin-arm64"
tools_dir="$build_root/tools-darwin-arm64"
[[ -x "$postgres_dir/bin/postgres" ]] || { echo "Run build-postgres.sh $postgres_version first" >&2; exit 64; }
[[ -x "$tools_dir/bin/bun" ]] || { echo "Run build-tools-bundle.sh first" >&2; exit 64; }

release_version="$(json_value "$release_manifest" version)"
commit="$(json_value "$release_manifest" commit)"
# The runtime version follows the web release; PostgreSQL and tool versions
# are recorded in the manifest.
version="$release_version"
[[ "$version" =~ ^[0-9]{8}\.[0-9]{6}-[0-9a-f]{8}$ ]] || { echo "Unexpected release version $version" >&2; exit 1; }
name="lumapos-runtime-$version"
out_dir="$build_root/$name"
archive="$build_root/$name.tar.gz"

step "assemble $version"
rm -rf "$out_dir"
mkdir -p "$out_dir/tools"
cp -Rc "$release_dir" "$out_dir/app"
rm -f "$out_dir/app/.env" "$out_dir/app/.env.local" "$out_dir/app/.env.production" "$out_dir/app/.env.production.local"
rm -rf "$out_dir/app/.next/cache"
cp -Rc "$postgres_dir" "$out_dir/postgresql-$postgres_major"
cp -Rc "$tools_dir/bin" "$out_dir/tools/bin"

step "manifest"
tool_version() { json_value "$tools_dir/BUILD_INFO.json" "tools.$1.version"; }
(
  cd "$out_dir"
  {
    printf '{\n'
    printf '  "format": 2,\n'
    printf '  "kind": "lumapos-runtime",\n'
    printf '  "version": "%s",\n' "$version"
    printf '  "commit": "%s",\n' "$commit"
    printf '  "builtAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "platform": "darwin-arm64",\n'
    printf '  "minimumMacOS": "14.0",\n'
    printf '  "postgres": { "version": "%s", "major": %s, "dir": "postgresql-%s" },\n' \
      "$postgres_version" "$postgres_major" "$postgres_major"
    printf '  "tools": { "bun": "%s", "cloudflared": "%s", "rclone": "%s" },\n' \
      "$(tool_version bun)" "$(tool_version cloudflared)" "$(tool_version rclone)"
    printf '  "files": {\n'
    find . -type f ! -path ./manifest.json -print0 \
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
/usr/bin/plutil -lint -s "$out_dir/manifest.json" >/dev/null 2>&1 \
  || python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$out_dir/manifest.json"

step "package"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$build_root" "$name"
shasum -a 256 "$archive" | awk '{print $1}' > "$archive.sha256"
step "built $name ($(du -sh "$out_dir" | cut -f1), archive $(du -h "$archive" | cut -f1))"
