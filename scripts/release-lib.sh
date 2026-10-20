#!/usr/bin/env bash
# Shared operator entry point; private environment files are never sourced.
ROOT="${SWW_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export SWW_INSTALL_DIR="$ROOT"
source "$ROOT/scripts/install-owner.sh"
require_install_owner "${BASH_SOURCE[1]}" "$@"
source "$ROOT/scripts/spaceworks-workspace-repository.sh"
source "$ROOT/scripts/compose-deployment.sh"
configure_release_repository
source "$ROOT/scripts/python-runtime.sh"
deployment_services
COMPOSE=(bash "$ROOT/scripts/spaceworks-workspace-compose.sh")
say() { printf '[Space Works Workspace] %s\n' "$*"; }
warn() { say "Warning: $*" >&2; }
die() { say "ERROR: $*" >&2; exit 1; }
OPS_DIR="$ROOT/backups"
LOCK_DIR="$ROOT/.sww-operation.lock"
mkdir -p "$OPS_DIR"
chmod 700 "$OPS_DIR"
source "$ROOT/scripts/update-lock.sh"
# Nested backup under an update shares the parent's lock; never release it here.
if [[ "${SWW_OPERATION_PARENT_PID:-}" != "$PPID" ]]; then
  acquire_update_lock
  trap release_update_lock EXIT
fi
