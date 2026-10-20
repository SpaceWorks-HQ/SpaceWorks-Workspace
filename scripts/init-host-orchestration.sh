#!/usr/bin/env bash
# Validate private config and save non-secret topology facts for operator review.
set -euo pipefail
ROOT="${SWW_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$ROOT/scripts/spaceworks-workspace-repository.sh"
configure_release_repository
source "$ROOT/scripts/python-runtime.sh"
python3 "$ROOT/scripts/configure-compose-wrapper.py" "$ROOT"
bash "$ROOT/scripts/spaceworks-workspace-compose.sh" config --quiet
