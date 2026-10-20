#!/usr/bin/env bash
# Workspace features are permission-scoped; deployment modules are infrastructure choices.
set -euo pipefail
ROOT="${SWW_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
echo 'Workspace features are managed inside the app. Deployment services are saved in .env.'
echo 'To change database/storage endpoints, edit the private config files as the install owner.'
echo 'Before changing topology, take a backup and review the selected services:'
bash "$ROOT/scripts/spaceworks-workspace-compose.sh" config --services
echo 'Use scripts/reconfigure.sh to review and change edge/container shape without replacing secrets.'
exec bash "$ROOT/scripts/reconfigure.sh"
