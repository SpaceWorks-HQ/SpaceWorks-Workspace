#!/bin/sh
# Entrypoint for the published images: spaceworks-workspace-backend (the `runner`
# target) and spaceworks-workspace-frontend. The command picks the role:
#
#   node server.js            the backend web server (default)
#   node frontend/server.js   the frontend web server (frontend image default)
#   migrate                   apply pending database migrations once, then exit
#   node docker/vps/*.mjs,    the VPS operator tools, run as given
#   node scripts/*.mjs
#   anything else             treated like a web server: it gets the origins
#                             applied and needs the runtime key (fails closed)
#
# Release images are built once for every installation, so the public origins
# Next.js compiles in are placeholders, replaced before a web server starts:
#   spaceworks-workspace-origin.invalid   <- NEXT_PUBLIC_BASE_URL (the site)
#   spaceworks-workspace-backend.invalid  <- NEXT_PUBLIC_BACKEND_ORIGIN (frontend image)
# Images built with real origins (Render, a local `docker build`) contain no
# placeholder and skip this.
#
# With MIGRATE_ON_START=1 the web server applies pending migrations first, for
# platforms without a separate release step (the Render free plan). Elsewhere
# run the `migrate` role (or the Helm migration Job) once per release.
# Migrations use DIRECT_URL (a direct or session-mode connection), falling back
# to DATABASE_URL. A failed migration exits non-zero.
set -eu

migrate() {
  DIRECT_URL="${DIRECT_URL:-${DATABASE_URL:-}}" CHECKPOINT_DISABLE=1 \
    node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma
}

if [ "${1:-}" = migrate ]; then
  echo "[entrypoint] Applying database migrations"
  migrate
  exit 0
fi

built=${SWW_NEXT_DIR:-/app/.next}

# apply_origin PLACEHOLDER_HOST VARIABLE VALUE: replace a compiled-in placeholder.
apply_origin() {
  placeholder=$1 name=$2 value=$3
  grep -rqF "$placeholder" "$built" 2>/dev/null || return 0
  # Validated before use in sed: no characters that are special to sed or JS strings.
  if ! printf '%s' "$value" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
    echo "[entrypoint] Set $name to an origin such as https://workspace.example.com (no path or trailing slash)." >&2
    exit 1
  fi
  pattern=$(printf '%s' "$placeholder" | sed 's/\./\\./g')
  echo "[entrypoint] Applying $name=$value"
  grep -rlF "$placeholder" "$built" | while IFS= read -r file; do
    sed -e "s|https://$pattern|$value|g" -e "s|$pattern|${value#*://}|g" "$file" > "$file.sww-origin"
    cat "$file.sww-origin" > "$file"
    rm -f "$file.sww-origin"
  done
  if grep -rqF "$placeholder" "$built"; then
    echo "[entrypoint] $name could not be applied to every file." >&2
    exit 1
  fi
}

case "${1:-}:${2:-}" in
  node:docker/vps/*|node:scripts/*|node:/app/docker/vps/*|node:/app/scripts/*)
    # Operator tools never serve requests and need no web settings.
    ;;
  *)
    if grep -rqF -e spaceworks-workspace-origin.invalid -e spaceworks-workspace-backend.invalid "$built" 2>/dev/null; then
      # The build's own key ships in every copy of the image; never fall back to it.
      if [ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]; then
        echo "[entrypoint] Set NEXT_SERVER_ACTIONS_ENCRYPTION_KEY to this installation's own stable key." >&2
        exit 1
      fi
      # next.config.ts compiles the Server Action origin allow-list into the build.
      if [ -n "${ALLOWED_ACTION_ORIGINS:-}" ]; then
        echo "[entrypoint] ALLOWED_ACTION_ORIGINS takes effect only at build time; build your own image to use it." >&2
        exit 1
      fi
    fi
    apply_origin spaceworks-workspace-origin.invalid NEXT_PUBLIC_BASE_URL "${NEXT_PUBLIC_BASE_URL:-}"
    apply_origin spaceworks-workspace-backend.invalid NEXT_PUBLIC_BACKEND_ORIGIN "${NEXT_PUBLIC_BACKEND_ORIGIN:-}"
    # An internal CA (Caddy local_certs, for LAN and test installs) appears
    # when the proxy starts; Node reads it only once, at start-up.
    if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then
      waited=0
      while [ ! -s "$NODE_EXTRA_CA_CERTS" ] && [ "$waited" -lt 120 ]; do sleep 1; waited=$((waited + 1)); done
    fi
    if [ "${MIGRATE_ON_START:-0}" = "1" ]; then
      echo "[entrypoint] Applying database migrations (MIGRATE_ON_START=1)"
      migrate
    fi
    ;;
esac

exec "$@"
