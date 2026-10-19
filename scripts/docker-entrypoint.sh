#!/bin/sh
# Entrypoint for the Space Works Workspace `runner` image.
#
# With MIGRATE_ON_START=1 the container applies pending Prisma migrations
# before starting the server. Use it only on platforms without a separate
# release job (Render free plan, a single container). Elsewhere leave it unset
# and run the `migrator` image (VPS stack, Helm hook, DO pre-deploy job) once
# per release, so several replicas never race to migrate.
#
# Migrations use DIRECT_URL (a direct or session-mode connection) and fall
# back to DATABASE_URL. A failed migration exits non-zero, so the new
# deployment never becomes healthy and the previous one keeps serving.
set -eu

if [ "${MIGRATE_ON_START:-0}" = "1" ]; then
  echo "[entrypoint] Applying database migrations (MIGRATE_ON_START=1)"
  DIRECT_URL="${DIRECT_URL:-${DATABASE_URL:-}}" CHECKPOINT_DISABLE=1 \
    node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma
fi

exec "$@"
