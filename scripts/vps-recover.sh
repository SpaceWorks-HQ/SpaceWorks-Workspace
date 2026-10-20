#!/usr/bin/env bash
# Recover super-admin access from the server, when the authenticator or the
# password is lost: removes the account's MFA, signs it out everywhere and
# prints a one-hour password-reset link. Only someone with root here can run it.
# shellcheck disable=SC2154 # ask assigns answers by name
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
require_root
require_tty
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
SWW_REPO_DIR=$source_dir
ask email 'Account email to recover' "$(conf_get "$SWW_CONFIG_DIR/app.env" SUPER_ADMIN_EMAIL)" is_email 'Enter an email address.'
cat >/dev/tty <<EOF

This removes the authenticator and recovery codes of $email, signs it out on
every device, and prints a password-reset link valid for one hour. It is
recorded in the audit log.
EOF
confirm 'Continue?' N || { say 'Cancelled. Nothing was changed.'; exit 2; }
compose run --rm --no-deps ops node docker/vps/recover-super-admin.mjs "$email"
