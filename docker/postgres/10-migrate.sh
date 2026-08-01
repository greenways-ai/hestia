#!/usr/bin/env bash
set -euo pipefail

for migration in /hestia-migrations/*.sql; do
  echo "applying $(basename "$migration")"
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"     --set=ON_ERROR_STOP=1 --file "$migration"
done
