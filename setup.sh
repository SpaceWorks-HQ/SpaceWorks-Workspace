#!/usr/bin/env bash
# Same guided deployment for a clone and a fetched release bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
source "$ROOT/scripts/install-owner.sh"
require_install_owner "$ROOT/setup.sh" "$@"
say() { printf '[Space Works Workspace setup] %s\n' "$*"; }
die() { say "ERROR: $*" >&2; exit 1; }
BUILD=0
case "${1:-}" in --build) BUILD=1 ;; '') ;; *) die 'Usage: setup.sh [--build]' ;; esac
source "$ROOT/scripts/spaceworks-workspace-repository.sh"
source "$ROOT/scripts/setup-questions.sh"
configure_release_repository
if [[ ! -f "$ROOT/.env" ]]; then
  if [[ -f "$ROOT/.sww-answers" ]]; then load_setup_answers "$ROOT/.sww-answers" || die 'Invalid private answers.'
  else ask_setup_questions || exit 0; persist_setup_answers "$ROOT/.sww-answers"; fi
fi
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then die 'Start Docker Desktop or use install.sh on Linux.'; fi
docker compose version >/dev/null 2>&1 || die 'Docker Compose V2 is required.'
if [[ -n "${SWW_GITHUB_TOKEN:-}" ]]; then
  printf '%s' "$SWW_GITHUB_TOKEN" | docker login ghcr.io --username "${SWW_REPOSITORY%%/*}" --password-stdin >/dev/null
fi
if [[ ! -f "$ROOT/.env" ]]; then
  if [[ "$BUILD" == 1 ]]; then docker build -t "$SWW_BACKEND_IMAGE:${SWW_IMAGE_TAG:-latest}" .
  elif [[ "${SWW_SKIP_PULL:-0}" == 1 ]]; then docker image inspect "$SWW_BACKEND_IMAGE:${SWW_IMAGE_TAG:-latest}" >/dev/null
  else docker pull "$SWW_BACKEND_IMAGE:${SWW_IMAGE_TAG:-latest}"; fi
  if [[ "$BUILD" == 0 && -z "${SWW_IMAGE_TAG:-}" ]]; then
    pinned="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$SWW_BACKEND_IMAGE:latest")"
    [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ ]] || die 'Image metadata has no immutable version. Set SWW_IMAGE_TAG explicitly.'
    export SWW_IMAGE_TAG="$pinned"
  fi
  source "$ROOT/scripts/setup-write-environment.sh"
  write_setup_environment
fi
export SWW_INSTALL_DIR="$ROOT"
COMPOSE=(bash "$ROOT/scripts/spaceworks-workspace-compose.sh")
source "$ROOT/scripts/compose-deployment.sh"
deployment_services
if [[ "$BUILD" == 1 ]]; then SWW_COMPOSE_BUILD=1 "${COMPOSE[@]}" build
elif [[ "${SWW_SKIP_PULL:-0}" != 1 ]]; then "${COMPOSE[@]}" pull; fi
# A forced migration container executes on every explicit setup/update, never in web.
if [[ "$(repository_env_value SWW_HOST_ROLE)" != frontend ]]; then
  data_services=()
  [[ "$(repository_env_value SWW_DATABASE)" != bundled ]] || data_services+=(postgres)
  [[ "$(repository_env_value SWW_REDIS)" != bundled ]] || data_services+=(redis)
  [[ "$(repository_env_value SWW_STORAGE)" != bundled ]] || data_services+=(silo)
  [[ ${#data_services[@]} == 0 ]] || "${COMPOSE[@]}" up -d --wait --wait-timeout 180 "${data_services[@]}"
  "${COMPOSE[@]}" up --force-recreate --no-deps --exit-code-from migrate migrate
fi
"${COMPOSE[@]}" up -d --remove-orphans
wait_for_backend || die 'Readiness timed out. Inspect the saved deployment logs.'
if [[ "$(repository_env_value SWW_HOST_ROLE)" != frontend ]]; then
  "${COMPOSE[@]}" exec -T "$APP_SERVICE" node /app/scripts/check-deployment.mjs
fi
version="${SWW_IMAGE_TAG:-$(repository_env_value SWW_IMAGE_TAG)}"
printf '%s\n' "$version" > "$ROOT/.spaceworks-workspace-version"
if [[ -f "$ROOT/.sww-answers" ]]; then
  [[ "${INSTALL_BACKUP_TIMER:-N}" != Y && "${INSTALL_BACKUP_TIMER:-N}" != y ]] || bash "$ROOT/scripts/setup-host-orchestration.sh"
  [[ "${INSTALL_RUNNER:-N}" != Y && "${INSTALL_RUNNER:-N}" != y ]] || bash "$ROOT/scripts/install-runner.sh"
  rm -f -- "$ROOT/.sww-answers"
fi
say "Ready. Open https://$(repository_env_value SWW_PUBLIC_HOST)/setup to create the owner account."
say 'Then configure email, enable MFA and save an encrypted off-server backup of config/.'
