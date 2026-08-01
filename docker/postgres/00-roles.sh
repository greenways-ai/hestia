#!/usr/bin/env bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   --set=app_password="$HESTIA_APP_PASSWORD" <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION postgres;

CREATE ROLE hestia_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
SQL
