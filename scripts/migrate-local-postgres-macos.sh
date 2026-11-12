#!/usr/bin/env bash
set -euo pipefail

bash scripts/setup-local-postgres-macos.sh

formula="postgresql@17"
pg_bin="$(brew --prefix "$formula")/bin"
database_user="$(id -un)"
if [[ ! "$database_user" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "The local macOS account name cannot be used safely in a PostgreSQL URL." >&2
  exit 1
fi

migration_url="postgresql://${database_user}@127.0.0.1:5432/lumapos_local"
"$pg_bin/psql" "$migration_url" -v ON_ERROR_STOP=1 \
  -f scripts/bootstrap-local-postgres-compat.sql

# The migration URL exists only for this process. It is a direct local session,
# so the runner keeps its backend-PID and advisory-lock checks enabled.
MIGRATION_DATABASE_URL="$migration_url" bun run src/db/apply-migrations.ts

echo "The local PostgreSQL schema migration is complete; this command did not import data."
