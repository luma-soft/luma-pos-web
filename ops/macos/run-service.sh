#!/bin/bash
set -euo pipefail

service_name="${1:-}"
app_root="${LUMAPOS_APP_ROOT:-}"
env_file="${LUMAPOS_ENV_FILE:-}"
bun_bin="${LUMAPOS_BUN_BIN:-}"

if [[ -z "$service_name" || -z "$app_root" || -z "$env_file" || -z "$bun_bin" ]]; then
  printf '%s\n' "LumaPOS service configuration is incomplete." >&2
  exit 78
fi

if [[ ! -d "$app_root" || ! -x "$bun_bin" ]]; then
  printf '%s\n' "LumaPOS application directory or Bun executable is unavailable." >&2
  exit 78
fi

for dotenv_file in .env .env.local .env.production .env.production.local; do
  if [[ -e "$app_root/$dotenv_file" ]]; then
    printf '%s\n' "Remove project dotenv files from the self-hosted release; use the protected runtime environment file." >&2
    exit 78
  fi
done

if [[ ! -f "$env_file" || -L "$env_file" ]]; then
  printf '%s\n' "LumaPOS runtime environment file is missing or is a symlink." >&2
  exit 78
fi

if [[ "$(stat -f '%Su' "$env_file")" != "$(id -un)" || "$(stat -f '%Lp' "$env_file")" != "600" ]]; then
  printf '%s\n' "LumaPOS runtime environment file must be owned by the service user with mode 600." >&2
  exit 78
fi

set -a
. "$env_file"
set +a

cd "$app_root"
umask 077

case "$service_name" in
  web)
    exec "$bun_bin" run start:self-hosted
    ;;
  sync)
    exec "$bun_bin" run sync:postgres:worker
    ;;
  notifications)
    exec "$bun_bin" run notifications:postgres:worker
    ;;
  backups)
    exec "$bun_bin" run db:backup:worker -- --scheduled
    ;;
  maintenance:media-cleanup|maintenance:notifications|maintenance:einvoices)
    exec "$bun_bin" run ops:maintenance -- "--task=${service_name#maintenance:}"
    ;;
  *)
    printf '%s\n' "Unknown LumaPOS service name." >&2
    exit 64
    ;;
esac
