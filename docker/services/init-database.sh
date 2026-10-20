#!/bin/sh
# Runs once, when the PostgreSQL volume is first initialised. Creates the
# least-privileged runtime role `sww_app`: no superuser, no CREATEDB, no
# CREATEROLE, and only DML on tables the migration role (`sww`) creates.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password POSTGRES_APP_PASSWORD
CREATE ROLE sww_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE sww TO sww_app;
GRANT USAGE ON SCHEMA public TO sww_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sww IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sww_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sww IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sww_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sww IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO sww_app;
SQL
