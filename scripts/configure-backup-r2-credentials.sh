#!/bin/bash
set -euo pipefail

env_file="${LUMAPOS_ENV_FILE:-/Users/Shared/LumaPOS/secrets/runtime.env}"
expected_bucket="lumapos-production-backups"

if [[ ! -f "$env_file" || -L "$env_file" ]]; then
  printf '%s\n' "Protected LumaPOS runtime environment file is missing or is a symlink." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    env_owner="$(stat -f '%Su' "$env_file")"
    env_mode="$(stat -f '%Lp' "$env_file")"
    ;;
  Linux)
    env_owner="$(stat -c '%U' "$env_file")"
    env_mode="$(stat -c '%a' "$env_file")"
    ;;
  *)
    printf '%s\n' "Credential setup supports only macOS and Linux." >&2
    exit 1
    ;;
esac

if [[ "$env_owner" != "$(id -un)" || "$env_mode" != "600" ]]; then
  printf '%s\n' "Runtime environment file must be owned by this user with mode 600." >&2
  exit 1
fi

for name in \
  LUMAPOS_BACKUP_R2_ACCOUNT_ID \
  LUMAPOS_BACKUP_R2_ACCESS_KEY_ID \
  LUMAPOS_BACKUP_R2_SECRET_ACCESS_KEY \
  LUMAPOS_BACKUP_R2_BUCKET; do
  if rg -q "^${name}=" "$env_file"; then
    printf '%s\n' "Backup R2 settings already exist; refusing to append duplicate keys." >&2
    exit 1
  fi
done

read -r -s -p "Cloudflare account ID (32 hex characters): " account_id
printf '\n'
read -r -s -p "R2 access key ID: " access_key_id
printf '\n'
read -r -s -p "R2 secret access key: " secret_access_key
printf '\n'

if [[ ! "$account_id" =~ ^[0-9a-fA-F]{32}$ ]]; then
  printf '%s\n' "Cloudflare account ID is invalid." >&2
  exit 1
fi
if [[ -z "$access_key_id" || -z "$secret_access_key" ]]; then
  printf '%s\n' "R2 token fields cannot be empty." >&2
  exit 1
fi

umask 077
{
  printf '\n# Dedicated encrypted backup bucket; do not reuse the media token.\n'
  printf 'LUMAPOS_BACKUP_R2_ACCOUNT_ID=%q\n' "$account_id"
  printf 'LUMAPOS_BACKUP_R2_ACCESS_KEY_ID=%q\n' "$access_key_id"
  printf 'LUMAPOS_BACKUP_R2_SECRET_ACCESS_KEY=%q\n' "$secret_access_key"
  printf 'LUMAPOS_BACKUP_R2_BUCKET=%s\n' "$expected_bucket"
} >> "$env_file"
chmod 600 "$env_file"
unset account_id access_key_id secret_access_key
printf '%s\n' "Backup R2 credentials were added without displaying their values."
