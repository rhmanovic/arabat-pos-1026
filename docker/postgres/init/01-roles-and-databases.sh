#!/usr/bin/env bash
# Creates the two application roles and the databases on first container start.
#   app_owner   – owns the schema, runs migrations, data migrations and seeds; BYPASSRLS
#                 so cross-merchant data migrations are possible (ADR-0031). Never used by the API.
#   app_runtime – used by the API; DML only, no superuser, no BYPASSRLS (ADR-0004)
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE app_owner LOGIN PASSWORD '${APP_OWNER_PASSWORD}' NOSUPERUSER NOCREATEROLE BYPASSRLS;
CREATE ROLE app_runtime LOGIN PASSWORD '${APP_RUNTIME_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL

for db in ${APP_DATABASES}; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE DATABASE ${db} OWNER app_owner;
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${db}" <<SQL
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO app_runtime;
ALTER SCHEMA public OWNER TO app_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
done
