#!/usr/bin/env bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgsodium;
SQL

for migration in /hestia-migrations/*.sql; do
  echo "applying $(basename "$migration")"
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 --file "$migration"
done

touch "${PGDATA:-/var/lib/postgresql/data}/.hestia-migrations-complete"
