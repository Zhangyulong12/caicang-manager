#!/bin/sh
set -eu
# Invoked by the official postgres image only when the dedicated production volume is empty.
CAICANG_APP_PASSWORD="$(cat /run/secrets/app_password)"
export CAICANG_APP_PASSWORD
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password CAICANG_APP_PASSWORD
CREATE ROLE caicang_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
unset CAICANG_APP_PASSWORD
