#!/bin/bash
# Builds a relocatable PostgreSQL for the packaged Mac host (darwin-arm64).
#
#   ops/macos/build-postgres.sh [version]
#
# Output: $LUMAPOS_BUILD_ROOT/postgres-<version>-darwin-arm64/ (bin, lib,
# share) and a .tar.gz of it with a .sha256 next to it. The tree works from
# any directory: PostgreSQL finds share/ and lib/ relative to bin/, and every
# Mach-O file loads its libraries through @rpath, so nothing points at the
# build prefix or Homebrew.
#
# Matches the store database: libc locales (no ICU), contrib (pg_trgm), lz4
# and zstd for pg_dump, OpenSSL for remote sources. Homebrew provides the
# libraries at build time only; they are copied into lib/.
#
# Progress lines start with "STEP:".
set -euo pipefail

version="${1:-17.11}"
build_root="${LUMAPOS_BUILD_ROOT:-$HOME/Library/Caches/LumaPOS/runtime-build}"
brew_prefix="${HOMEBREW_PREFIX:-/opt/homebrew}"
export PATH="$brew_prefix/bin:/usr/bin:/bin:/usr/sbin:/sbin"

[[ "$version" =~ ^[0-9]+\.[0-9]+$ ]] || { echo "Version must look like 17.11" >&2; exit 64; }
[[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]] || { echo "Build on Apple silicon macOS" >&2; exit 64; }

step() { printf 'STEP:%s\n' "$1"; }

name="postgres-$version-darwin-arm64"
src_dir="$build_root/src"
out_dir="$build_root/$name"
archive="$build_root/$name.tar.gz"
tarball="postgresql-$version.tar.bz2"
url="https://ftp.postgresql.org/pub/source/v$version/$tarball"

dep_prefixes=()
for formula in openssl@3 lz4 zstd; do
  prefix="$(brew --prefix "$formula" 2>/dev/null)" && [[ -d "$prefix/lib" ]] \
    || { echo "Missing Homebrew formula $formula (build-time only)" >&2; exit 69; }
  dep_prefixes+=("$prefix")
done

mkdir -p "$src_dir"
step "source $version"
if [[ ! -f "$src_dir/$tarball" ]]; then
  curl -fsSL --retry 3 -o "$src_dir/$tarball.part" "$url"
  curl -fsSL --retry 3 -o "$src_dir/$tarball.sha256" "$url.sha256"
  expected="$(awk '{print $1; exit}' "$src_dir/$tarball.sha256")"
  actual="$(shasum -a 256 "$src_dir/$tarball.part" | awk '{print $1}')"
  [[ -n "$expected" && "$expected" == "$actual" ]] || { echo "Checksum mismatch for $tarball" >&2; exit 1; }
  mv "$src_dir/$tarball.part" "$src_dir/$tarball"
fi
tarball_sha256="$(shasum -a 256 "$src_dir/$tarball" | awk '{print $1}')"

work="$src_dir/postgresql-$version"
rm -rf "$work"
tar -xjf "$src_dir/$tarball" -C "$src_dir"

step "configure"
# A throwaway prefix: the tree is moved to $out_dir and made relocatable.
stage_prefix="$build_root/.stage-$name"
rm -rf "$stage_prefix"
cppflags=""
# Room in the Mach-O headers for the @rpath rewrite below.
ldflags="-Wl,-headerpad_max_install_names"
for prefix in "${dep_prefixes[@]}"; do
  cppflags+=" -I$prefix/include"
  ldflags+=" -L$prefix/lib"
done
(
  cd "$work"
  CPPFLAGS="$cppflags" LDFLAGS="$ldflags" ./configure \
    --prefix="$stage_prefix" \
    --disable-rpath --disable-nls \
    --without-icu --without-ldap --without-gssapi --without-pam \
    --with-openssl --with-lz4 --with-zstd \
    --with-libedit-preferred \
    >"$build_root/configure-$version.log" 2>&1
) || { echo "configure failed; see $build_root/configure-$version.log" >&2; exit 1; }

step "compile"
jobs="$(sysctl -n hw.ncpu)"
(
  cd "$work"
  make -j"$jobs" world-bin >"$build_root/make-$version.log" 2>&1
  make install-world-bin >>"$build_root/make-$version.log" 2>&1
) || { echo "make failed; see $build_root/make-$version.log" >&2; exit 1; }

step "trim"
rm -rf "$out_dir"
mv "$stage_prefix" "$out_dir"
rm -rf "$out_dir/include" "$out_dir/lib/pgxs" "$out_dir/lib/pkgconfig" "$out_dir/share/doc" "$out_dir/share/man"
find "$out_dir/lib" -name '*.a' -delete

step "relocate"
is_macho() { file -b "$1" | grep -q 'Mach-O'; }
macho_files=()
while IFS= read -r -d '' candidate; do
  is_macho "$candidate" && macho_files+=("$candidate")
done < <(find "$out_dir/bin" "$out_dir/lib" -type f -print0)

# Copy third-party libraries (and what they load) into lib/.
copy_dependencies() {
  local file="$1" dep base
  for dep in $(otool -L "$file" | awk 'NR > 1 {print $1}'); do
    case "$dep" in
      "$brew_prefix"/*)
        base="$(basename "$dep")"
        if [[ ! -f "$out_dir/lib/$base" ]]; then
          cp -L "$dep" "$out_dir/lib/$base"
          chmod 0644 "$out_dir/lib/$base"
          macho_files+=("$out_dir/lib/$base")
          copy_dependencies "$out_dir/lib/$base"
        fi
        ;;
    esac
  done
}
for file in "${macho_files[@]}"; do copy_dependencies "$file"; done

for file in "${macho_files[@]}"; do
  chmod u+w "$file"
  base="$(basename "$file")"
  relative="${file#"$out_dir"/}"
  # Own dylibs are found through @rpath.
  # Own shared libraries (not loadable modules, which have no install name)
  # are found through @rpath.
  if otool -D "$file" | awk 'NR > 1' | grep -q .; then
    install_name_tool -id "@rpath/$base" "$file"
  fi
  for dep in $(otool -L "$file" | awk 'NR > 1 {print $1}'); do
    case "$dep" in
      "$brew_prefix"/*|"$stage_prefix"/*)
        install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$file"
        ;;
    esac
  done
  # Loadable modules sit in lib/ (pkglibdir == libdir because the install
  # directory name contains "postgres").
  case "$relative" in
    bin/*) rpath="@executable_path/../lib" ;;
    *) rpath="@loader_path" ;;
  esac
  otool -l "$file" | grep -q "path $rpath " || install_name_tool -add_rpath "$rpath" "$file"
  codesign --force --sign - "$file" 2>/dev/null
done

step "verify"
leaks=0
for file in "${macho_files[@]}"; do
  if otool -L "$file" | awk 'NR > 1 {print $1}' | grep -qE "^($brew_prefix|$stage_prefix|$build_root)"; then
    echo "Absolute library path left in ${file#"$out_dir"/}" >&2
    leaks=1
  fi
done
[[ "$leaks" == 0 ]] || exit 1
"$out_dir/bin/postgres" --version >/dev/null
[[ -f "$out_dir/lib/pg_trgm.dylib" ]] || { echo "pg_trgm missing" >&2; exit 1; }

step "package"
printf '{\n  "name": "postgres",\n  "version": "%s",\n  "platform": "darwin-arm64",\n  "source": "%s",\n  "sourceSha256": "%s",\n  "builtAt": "%s"\n}\n' \
  "$version" "$url" "$tarball_sha256" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out_dir/BUILD_INFO.json"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$build_root" "$name"
shasum -a 256 "$archive" | awk '{print $1}' > "$archive.sha256"
rm -rf "$work"

step "built $name ($(du -sh "$out_dir" | cut -f1), archive $(du -h "$archive" | cut -f1))"
