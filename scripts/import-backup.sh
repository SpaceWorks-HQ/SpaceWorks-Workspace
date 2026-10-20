#!/usr/bin/env bash
# Cross-host import uses the same offline verifier and explicit replacement acknowledgement.
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/restore.sh" "$@"
