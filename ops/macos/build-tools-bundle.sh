#!/bin/bash
# Collects the third-party command-line tools the packaged Mac host runs:
# bun, cloudflared and rclone. Each must be a single self-contained arm64
# binary (only system libraries). Their publishers' signatures are kept.
#
#   ops/macos/build-tools-bundle.sh
#
# Sources (override to pin other copies):
#   LUMAPOS_BUN_SOURCE          default /Users/Shared/LumaPOS/bin/bun
#   LUMAPOS_CLOUDFLARED_SOURCE  default `command -v cloudflared`
#   LUMAPOS_RCLONE_SOURCE       default `command -v rclone`
#
# Output: $LUMAPOS_BUILD_ROOT/tools-darwin-arm64/{bin/*,BUILD_INFO.json}
set -euo pipefail

build_root="${LUMAPOS_BUILD_ROOT:-$HOME/Library/Caches/LumaPOS/runtime-build}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
out_dir="$build_root/tools-darwin-arm64"

step() { printf 'STEP:%s\n' "$1"; }

bun_source="${LUMAPOS_BUN_SOURCE:-/Users/Shared/LumaPOS/bin/bun}"
cloudflared_source="${LUMAPOS_CLOUDFLARED_SOURCE:-$(command -v cloudflared || true)}"
rclone_source="${LUMAPOS_RCLONE_SOURCE:-$(command -v rclone || true)}"

rm -rf "$out_dir"
mkdir -p "$out_dir/bin"
info_entries=()

add_tool() {
  local name="$1" source="$2" version_args="$3" resolved version deps
  [[ -n "$source" && -x "$source" ]] || { echo "Missing $name binary" >&2; exit 69; }
  resolved="$(cd "$(dirname "$source")" && pwd -P)/$(basename "$source")"
  [[ -L "$resolved" ]] && resolved="$(readlink -f "$resolved")"
  file -b "$resolved" | grep -q 'Mach-O 64-bit executable arm64' \
    || { echo "$name is not an arm64 executable" >&2; exit 1; }
  deps="$(otool -L "$resolved" | awk 'NR > 1 {print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' || true)"
  [[ -z "$deps" ]] || { echo "$name links non-system libraries: $deps" >&2; exit 1; }
  cp -p "$resolved" "$out_dir/bin/$name"
  chmod 0755 "$out_dir/bin/$name"
  version="$("$out_dir/bin/$name" $version_args 2>&1 | head -n 1 | tr -d '"\\')"
  info_entries+=("$(printf '    "%s": { "version": "%s", "sha256": "%s" }' \
    "$name" "$version" "$(shasum -a 256 "$out_dir/bin/$name" | awk '{print $1}')")")
  step "tool $name $version"
}

add_tool bun "$bun_source" --version
add_tool cloudflared "$cloudflared_source" --version
add_tool rclone "$rclone_source" version

{
  printf '{\n  "name": "tools",\n  "platform": "darwin-arm64",\n  "builtAt": "%s",\n  "tools": {\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for i in "${!info_entries[@]}"; do
    printf '%s%s\n' "${info_entries[$i]}" "$([[ $i -lt $((${#info_entries[@]} - 1)) ]] && echo ,)"
  done
  printf '  }\n}\n'
} > "$out_dir/BUILD_INFO.json"

step "built tools ($(du -sh "$out_dir" | cut -f1))"
