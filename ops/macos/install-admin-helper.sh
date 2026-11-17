#!/bin/bash
# Installs the LumaPOS administrative helper and lets one Mac user run it
# without a password, so the Mac host console stops asking for the
# administrator password on every deploy, service action or log read.
#
#   sudo bash ops/macos/install-admin-helper.sh            # for the user running sudo
#   sudo bash ops/macos/install-admin-helper.sh <user>     # for another user
#   sudo bash ops/macos/install-admin-helper.sh --uninstall
#
# What it changes:
#   /usr/local/libexec/lumapos-admin   root:wheel 0755, copy of ops/macos/lumapos-admin
#   /etc/sudoers.d/lumapos             root:wheel 0440, NOPASSWD for that one file
# Re-run it after pulling a newer lumapos-admin to update the installed copy.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

readonly HELPER_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lumapos-admin"
readonly HELPER_DIR=/usr/local/libexec
readonly HELPER_PATH="$HELPER_DIR/lumapos-admin"
readonly SUDOERS_PATH=/etc/sudoers.d/lumapos

[[ "$(id -u)" == 0 ]] || { echo "Run with sudo." >&2; exit 77; }

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$SUDOERS_PATH" "$HELPER_PATH"
  echo "Removed $SUDOERS_PATH and $HELPER_PATH"
  exit 0
fi

user="${1:-${SUDO_USER:-}}"
[[ -n "$user" && "$user" != root ]] || { echo "Name the Mac user: sudo bash $0 <user>" >&2; exit 64; }
[[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] && id "$user" >/dev/null 2>&1 || { echo "Unknown user: $user" >&2; exit 67; }
[[ -f "$HELPER_SOURCE" ]] || { echo "Missing $HELPER_SOURCE" >&2; exit 66; }
bash -n "$HELPER_SOURCE"

# /usr/local and the helper must not be writable by anyone but root, or the
# sudoers rule would let that user run arbitrary code as root.
for dir in /usr /usr/local; do
  [[ "$(stat -f '%Su' "$dir")" == root && ! -L "$dir" ]] || { echo "$dir must be owned by root" >&2; exit 1; }
  perms="$(stat -f '%Lp' "$dir")"
  (( (8#$perms & 8#022) == 0 )) || { echo "$dir must not be group/world writable" >&2; exit 1; }
done

install -d -o root -g wheel -m 0755 "$HELPER_DIR"
install -o root -g wheel -m 0755 "$HELPER_SOURCE" "$HELPER_PATH"

rule_file="$(mktemp)"
trap 'rm -f "$rule_file"' EXIT
cat > "$rule_file" <<EOF
# Managed by luma-pos-web/ops/macos/install-admin-helper.sh
# Lets $user deploy LumaPOS releases, control com.lumapos.* services and read
# their logs from the Mac host console without the administrator password.
$user ALL=(root) NOPASSWD: $HELPER_PATH
EOF
visudo -cf "$rule_file" >/dev/null
install -o root -g wheel -m 0440 "$rule_file" "$SUDOERS_PATH"
visudo -c >/dev/null

echo "Installed $HELPER_PATH (version $("$HELPER_PATH" version)) for $user"
sudo -u "$user" sudo -n "$HELPER_PATH" version >/dev/null && echo "Password-free access verified for $user"
