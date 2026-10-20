#!/usr/bin/env bash
# Change settings after installation, from the installer menu:
#   1) hostnames   2) outgoing email (SMTP)   3) external bucket credentials
# It backs up the database and configuration first, recreates the services and
# runs the checks; if they fail, the previous settings are put back.
# Switching between bundled Silo and an external bucket is not done here: it
# needs a data migration (see docs/DEPLOYMENT_VPS.md).
# shellcheck disable=SC2154 # ask assigns answers by name
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
require_root
require_tty
load_config_dir
compose_env="$SWW_CONFIG_DIR/compose.env"
[[ -f "$compose_env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
SWW_REPO_DIR=$source_dir
layout=$(conf_get "$compose_env" SWW_LAYOUT)
layout=${layout:-single}
storage=$(conf_get "$compose_env" SWW_STORAGE)

cat >/dev/tty <<EOF

Change settings
  1) Hostnames - now $(conf_get "$compose_env" PUBLIC_ORIGIN)$([[ $layout = single ]] || echo " (API https://$(conf_get "$compose_env" PUBLIC_HOST))")
  2) Outgoing email (SMTP) - now $(conf_get "$SWW_CONFIG_DIR/app.env" SMTP_HOST)
EOF
[[ "$storage" != external ]] || printf '  3) External bucket credentials - now %s\n' "$(conf_get "$SWW_CONFIG_DIR/app.env" S3_BUCKET)" >/dev/tty
printf '  0) Cancel\n' >/dev/tty
is_choice() { [[ "$1" =~ ^[0-2]$ || ( "$1" = 3 && "$storage" = external ) ]]; }
ask choice 'Choose' 0 is_choice 'Enter one of the numbers shown.'
[[ $choice != 0 ]] || { say 'Cancelled. Nothing was changed.'; exit 2; }

# Settings files this change may edit, saved to put back on failure.
files=("$compose_env" "$SWW_CONFIG_DIR/app.env")
[[ ! -f "$SWW_CONFIG_DIR/frontend.env" ]] || files+=("$SWW_CONFIG_DIR/frontend.env")

case $choice in
  1)
    if [[ $layout = single ]]; then
      ask public_host 'Public hostname (its DNS A record points at this server)' "$(conf_get "$compose_env" PUBLIC_HOST)" is_hostname 'Enter a hostname such as workspace.example.com.'
      public_host=${public_host,,}
      site_host=$public_host
    else
      ask site_host "Website hostname$([[ $layout = netlify ]] && echo ' (on Netlify)')" "$(conf_get "$SWW_CONFIG_DIR/frontend.env" NEXT_PUBLIC_BASE_URL | sed 's#^https://##')" is_hostname 'Enter a hostname such as workspace.example.com.'
      site_host=${site_host,,}
      is_api_host() { is_hostname "$1" && [[ "${1,,}" != "$site_host" ]]; }
      ask public_host 'API hostname (its DNS A record points at this server)' "$(conf_get "$compose_env" PUBLIC_HOST)" is_api_host 'Enter a different hostname, such as api.workspace.example.com.'
      public_host=${public_host,,}
    fi
    cat >/dev/tty <<EOF

The site moves to https://$site_host$([[ $layout = single ]] || echo " with the API at https://$public_host").
Point DNS at this server first. Everyone is signed out, and links already sent
(invitations and resets) keep the old hostname.
EOF
    ;;
  2)
    printf '\nOutgoing email needs an authenticated SMTP relay on a verified sending domain.\n' >/dev/tty
    ask EMAIL_FROM 'Sender, as Name <address@your-verified-domain>' "$(conf_get "$SWW_CONFIG_DIR/app.env" EMAIL_FROM)" is_env_value "Enter a sender without ' or \\ characters."
    ask SMTP_HOST 'SMTP host' "$(conf_get "$SWW_CONFIG_DIR/app.env" SMTP_HOST)" is_hostname 'Enter the relay hostname, such as smtp-relay.brevo.com.'
    ask SMTP_PORT 'SMTP port (Brevo: 2525 or 587; implicit TLS: 465)' "$(conf_get "$SWW_CONFIG_DIR/app.env" SMTP_PORT)" is_port 'Enter a port number between 1 and 65535.'
    SMTP_SECURE=false
    [[ $SMTP_PORT != 465 ]] || SMTP_SECURE=true
    ask SMTP_USER 'SMTP login' "$(conf_get "$SWW_CONFIG_DIR/app.env" SMTP_USER)" is_env_value "Enter the login, without ' or \\ characters."
    ask_secret SMTP_PASSWORD 'SMTP password or key (hidden)'
    ;;
  3)
    ask S3_ACCESS_KEY_ID 'Access key ID' '' is_env_value "Enter the access key, without ' or \\ characters."
    ask_secret S3_SECRET_ACCESS_KEY 'Secret access key (hidden)'
    ;;
esac
confirm 'Apply this change? The site restarts briefly.' Y || { say 'Cancelled. Nothing was changed.'; exit 2; }

take_lock
say 'Backing up the database and configuration first.'
bash "$SWW_REPO_DIR/scripts/vps-backup.sh" --no-objects
for file in "${files[@]}"; do cp -p "$file" "$file.previous"; done
restore_settings() {
  local status=$? file
  [[ $status != 0 ]] || return 0
  set +e
  warn 'The change did not work; putting the previous settings back.'
  for file in "${files[@]}"; do [[ ! -f "$file.previous" ]] || mv -f "$file.previous" "$file"; done
  compose up -d --wait --wait-timeout 300 --force-recreate >/dev/null 2>&1 || warn 'Start the services with scripts/vps-compose.sh up -d.'
  exit "$status"
}
trap restore_settings EXIT
# The backend image's tools write app.env as root, like the guided setup.
run_tool() { docker run --rm --user 0:0 --volume "$SWW_CONFIG_DIR:/config" "$@" "$(backend_image)" node "docker/vps/$tool"; }
case $choice in
  1)
    conf_set "$compose_env" PUBLIC_HOST "$public_host"
    conf_set "$compose_env" PUBLIC_ORIGIN "https://$site_host"
    [[ $layout != split ]] || conf_set "$compose_env" SITE_HOST "$site_host"
    conf_set "$SWW_CONFIG_DIR/app.env" AUTH_URL "https://$site_host"
    conf_set "$SWW_CONFIG_DIR/app.env" NEXT_PUBLIC_BASE_URL "https://$site_host"
    [[ $layout = single ]] || conf_set "$SWW_CONFIG_DIR/app.env" BACKEND_ORIGIN "https://$public_host"
    if [[ -f "$SWW_CONFIG_DIR/frontend.env" ]]; then
      conf_set "$SWW_CONFIG_DIR/frontend.env" NEXT_PUBLIC_BASE_URL "https://$site_host"
      conf_set "$SWW_CONFIG_DIR/frontend.env" BACKEND_ORIGIN "https://$public_host"
      conf_set "$SWW_CONFIG_DIR/frontend.env" NEXT_PUBLIC_BACKEND_ORIGIN "https://$public_host"
    fi
    ;;
  2)
    export EMAIL_FROM SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD
    tool=configure-smtp.mjs run_tool --env EMAIL_FROM --env SMTP_HOST --env SMTP_PORT --env SMTP_SECURE --env SMTP_USER --env SMTP_PASSWORD
    unset SMTP_PASSWORD
    ;;
  3)
    S3_ENDPOINT=$(conf_get "$SWW_CONFIG_DIR/app.env" S3_ENDPOINT) S3_REGION=$(conf_get "$SWW_CONFIG_DIR/app.env" S3_REGION)
    S3_BUCKET=$(conf_get "$SWW_CONFIG_DIR/app.env" S3_BUCKET)
    export S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
    tool=configure-storage.mjs run_tool --env S3_ENDPOINT --env S3_REGION --env S3_BUCKET --env S3_ACCESS_KEY_ID --env S3_SECRET_ACCESS_KEY
    unset S3_SECRET_ACCESS_KEY
    ;;
esac
compose up -d --wait --wait-timeout 300 --force-recreate
compose run --rm --no-deps ops node docker/vps/check.mjs
[[ $choice != 2 ]] || compose run --rm --no-deps ops node docker/vps/check.mjs smtp
for file in "${files[@]}"; do rm -f "$file.previous"; done
trap - EXIT
case $choice in
  1)
    say "Done. The site is at https://$site_host."
    [[ $layout != netlify ]] || say "Set the same values in your Netlify site's environment (see $SWW_CONFIG_DIR/frontend.env) and redeploy it."
    ;;
  2) say 'Done. Send a test email from Super admin → Email to confirm delivery.' ;;
  3) say 'Done. The new bucket key is in use.' ;;
esac
