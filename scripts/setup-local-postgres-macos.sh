#!/usr/bin/env bash
set -euo pipefail

formula="postgresql@17"
database="${LUMAPOS_LOCAL_DATABASE_NAME:-lumapos_local}"
if [[ ! "$database" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$ ]]; then
  echo "LUMAPOS_LOCAL_DATABASE_NAME must be a valid PostgreSQL database name." >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to set up local PostgreSQL on macOS." >&2
  exit 1
fi

if ! brew list --versions "$formula" >/dev/null 2>&1; then
  brew install "$formula"
fi

pg_bin="$(brew --prefix "$formula")/bin"
pg_isready="$pg_bin/pg_isready"
psql="$pg_bin/psql"
createdb="$pg_bin/createdb"

if ! "$pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  brew services start "$formula"
  for attempt in {1..20}; do
    if "$pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! "$pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready on 127.0.0.1:5432." >&2
  exit 1
fi

listen_addresses="$("$psql" -h 127.0.0.1 -p 5432 -d postgres -Atc 'show listen_addresses')"
if [[ "$listen_addresses" != "localhost" && "$listen_addresses" != "127.0.0.1" ]]; then
  echo "Refusing to use PostgreSQL with a non-loopback listen_addresses setting." >&2
  exit 1
fi

database_exists="$("$psql" -h 127.0.0.1 -p 5432 -d postgres -Atc \
  "select 1 from pg_database where datname = '$database'")"
if [[ "$database_exists" != "1" ]]; then
  "$createdb" -h 127.0.0.1 -p 5432 "$database"
fi

echo "PostgreSQL 17 is ready at 127.0.0.1:5432; database '$database' is available."
echo "This setup does not apply the app schema or import Supabase data."
