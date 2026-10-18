#!/usr/bin/env bash
# Guided first installation of the Space Works Workspace VPS stack.
# Existing installations use scripts/update-vps.sh; setup never replaces secrets.
#
#   bash scripts/setup-vps.sh                  (prompts)
#   SWW_NONINTERACTIVE=1 SWW_DOMAIN=work.example.org SWW_ADMIN_EMAIL=you@example.org \
#     bash scripts/setup-vps.sh                (unattended, e.g. cloud-init)
#
# Answers (environment variables, all optional in interactive mode):
#   SWW_DOMAIN, SWW_ADMIN_EMAIL, SWW_CONFIG_DIR (/etc/spaceworks-workspace)
#   SWW_CONFIGURE_SMTP (y/n), SWW_EMAIL_FROM, SWW_SMTP_HOST, SWW_SMTP_PORT (587),
#   SWW_SMTP_TLS (y = implicit TLS on 465), SWW_SMTP_USER, SWW_SMTP_PASSWORD
#   SWW_ANTHROPIC_API_KEY (optional), SWW_INSTALL_DOCKER (y/n), SWW_BACKUP_TIMER (y/n)
# Advanced: SWW_CADDY_TLS (acme | internal), SWW_HTTP_PORT, SWW_HTTPS_PORT,
#   SWW_BIND_PREFIX (e.g. "127.0.0.1:"), SWW_PROJECT (Compose project name)
set -euo pipefail
set +x
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
# shellcheck source=scripts/vps-lib.sh
. "$repo_dir/scripts/vps-lib.sh"
[[ "$noninteractive" = 1 || -t 0 ]] || die 'Run the installer in an interactive terminal, or set SWW_NONINTERACTIVE=1 with the answers as environment variables.'

printf 'Space Works Workspace: first installation\n\n'
ask SWW_DOMAIN 'Public hostname (work.example.org)'
ask SWW_ADMIN_EMAIL 'Instance admin email (gets /admin and certificate notices)'
ask SWW_CONFIG_DIR 'External configuration directory' "$SWW_DEFAULT_CONFIG_DIR"
yes_no SWW_CONFIGURE_SMTP 'Configure outgoing email (SMTP) now? You can also do it later in /admin' y
if [[ "$SWW_CONFIGURE_SMTP" = y ]]; then
  ask SWW_EMAIL_FROM 'Verified sender (Space Works <workspace@example.org>)'
  ask SWW_SMTP_HOST 'SMTP hostname'
  ask SWW_SMTP_PORT 'SMTP port' 587
  yes_no SWW_SMTP_TLS 'Use implicit TLS (usually port 465)?' n
  ask SWW_SMTP_USER 'SMTP username'
  ask SWW_SMTP_PASSWORD 'SMTP password (hidden)' '' secret
fi
ask SWW_ANTHROPIC_API_KEY 'Anthropic API key for the assistant (optional, hidden; Enter to skip)' '' secret

domain=$(printf '%s' "$SWW_DOMAIN" | tr '[:upper:]' '[:lower:]')
caddy_tls=${SWW_CADDY_TLS:-acme}
http_port=${SWW_HTTP_PORT:-80}
https_port=${SWW_HTTPS_PORT:-443}
origin="https://$domain"
[[ "$https_port" = 443 ]] || origin="$origin:$https_port"
host_pattern='^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
[[ "$domain" =~ $host_pattern && ${#domain} -le 253 ]] || die 'Enter a valid public DNS hostname, such as work.example.org.'
[[ "$SWW_ADMIN_EMAIL" =~ ^[^[:space:]@\'\"]+@[^[:space:]@\'\"]+\.[^[:space:]@\'\"]+$ ]] || die 'Enter a valid admin email.'
[[ "$SWW_CONFIG_DIR" = /* && "$SWW_CONFIG_DIR" != *[[:space:]:]* ]] || die 'Use an absolute configuration path without spaces or colons.'
case "$SWW_CONFIG_DIR/" in "$repo_dir/"*) die 'Keep production configuration outside the source directory.' ;; esac
[[ ! -e "$SWW_CONFIG_DIR/compose.env" ]] || die 'Configuration already exists. Use scripts/update-vps.sh (or install.sh --update); setup never replaces secrets.'
[[ "$caddy_tls" = acme || "$caddy_tls" = internal ]] || die 'SWW_CADDY_TLS must be acme or internal.'
if [[ "$SWW_CONFIGURE_SMTP" = y ]]; then
  # shellcheck disable=SC2153 # assigned by ask above
  [[ "$SWW_SMTP_PORT" =~ ^[0-9]{1,5}$ && "$SWW_SMTP_PORT" -ge 1 && "$SWW_SMTP_PORT" -le 65535 ]] || die 'Enter a valid SMTP port.'
  [[ -n "$SWW_SMTP_HOST" && -n "$SWW_SMTP_USER" && -n "$SWW_SMTP_PASSWORD" && -n "$SWW_EMAIL_FROM" ]] || die 'Complete the SMTP settings, or answer n and configure email later in /admin.'
fi
revision=$(release_revision)
version="vps-${revision:0:12}"

printf '\nDeploy %s to %s\n' "$revision" "$origin"
printf 'Configuration: %s\nAdmin: %s\nEmail: %s\nAssistant key: %s\n' "$SWW_CONFIG_DIR" "$SWW_ADMIN_EMAIL" \
  "$([[ "$SWW_CONFIGURE_SMTP" = y ]] && printf 'SMTP via %s' "$SWW_SMTP_HOST" || printf 'not configured (set it in /admin)')" \
  "$([[ -n "$SWW_ANTHROPIC_API_KEY" ]] && printf 'provided' || printf 'not set')"
echo 'This builds Docker images, creates volumes, applies migrations and opens ports 80 and 443.'
echo 'DNS for the hostname must point at this server before HTTPS can be issued.'
confirm 'Proceed with installation?'

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  yes_no SWW_INSTALL_DOCKER 'Docker Engine with Compose is missing. Install it from Docker'"'"'s apt repository (Ubuntu/Debian)?' y
  [[ "$SWW_INSTALL_DOCKER" = y ]] || die 'Install Docker Engine and the Compose plugin, then rerun setup.'
  bash "$repo_dir/scripts/install-docker.sh"
fi
docker info >/dev/null 2>&1 || die 'Docker is installed but not usable by this user. Run with sudo or add the user to the docker group.'

if [[ ! -d "$SWW_CONFIG_DIR" ]]; then
  mkdir -p "$SWW_CONFIG_DIR" 2>/dev/null || sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" "$SWW_CONFIG_DIR"
fi
chmod 0700 "$SWW_CONFIG_DIR"
export SWW_CONFIG_DIR

echo 'Building the operator image...'
docker build --quiet --target ops --tag sww-ops:bootstrap . >/dev/null
smtp_secure=false
[[ "${SWW_SMTP_TLS:-n}" = y ]] && smtp_secure=true
# Answers reach the container as environment variables, never as arguments.
SETUP_PUBLIC_HOST=$domain SETUP_PUBLIC_ORIGIN=$origin SETUP_ADMIN_EMAIL=$SWW_ADMIN_EMAIL SETUP_VERSION=$version \
SETUP_PROJECT=${SWW_PROJECT:-spaceworks-workspace} SETUP_CADDY_TLS=$caddy_tls SETUP_HTTP_PORT=$http_port \
SETUP_HTTPS_PORT=$https_port SETUP_BIND_PREFIX=${SWW_BIND_PREFIX:-} \
EMAIL_FROM=${SWW_EMAIL_FROM:-} SMTP_HOST=${SWW_SMTP_HOST:-} SMTP_PORT=${SWW_SMTP_PORT:-} SMTP_SECURE=$smtp_secure \
SMTP_USER=${SWW_SMTP_USER:-} SMTP_PASSWORD=${SWW_SMTP_PASSWORD:-} ANTHROPIC_API_KEY=${SWW_ANTHROPIC_API_KEY:-} \
docker run --rm --user "$(id -u):$(id -g)" --volume "$SWW_CONFIG_DIR:/config" \
  --env SETUP_PUBLIC_HOST --env SETUP_PUBLIC_ORIGIN --env SETUP_ADMIN_EMAIL --env SETUP_VERSION --env SETUP_PROJECT \
  --env SETUP_CADDY_TLS --env SETUP_HTTP_PORT --env SETUP_HTTPS_PORT --env SETUP_BIND_PREFIX \
  --env EMAIL_FROM --env SMTP_HOST --env SMTP_PORT --env SMTP_SECURE --env SMTP_USER --env SMTP_PASSWORD --env ANTHROPIC_API_KEY \
  sww-ops:bootstrap node docker/vps/setup.mjs
unset SWW_SMTP_PASSWORD SWW_ANTHROPIC_API_KEY

echo 'Building release images (several minutes on a small server)...'
compose config --quiet
compose build ops migrator app
compose run --rm --no-deps ops node docker/vps/check.mjs preflight
echo 'Starting PostgreSQL, Redis, storage, migrations, the app, the scheduler and HTTPS...'
compose up -d --wait --wait-timeout 300
compose run --rm --no-deps ops node docker/vps/check.mjs

if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system && $(id -u) = 0 ]]; then
  yes_no SWW_BACKUP_TIMER 'Install the daily backup timer (database, storage, configuration)?' y
  if [[ "$SWW_BACKUP_TIMER" = y ]]; then
    bash "$repo_dir/scripts/vps-backup.sh" --install-timer "${SWW_INSTALL_DIR:+$SWW_INSTALL_DIR/current}"
  fi
fi

printf '\nSpace Works Workspace is running.\n\n'
printf '  Finish setup:  %s/setup\n' "$origin"
printf '  Health:        %s/api/health\n\n' "$origin"
echo "Open /setup now: it creates the owner account and first workspace, and closes once an account exists."
printf 'The account %s opens /admin once it has two-step verification enabled.\n' "$SWW_ADMIN_EMAIL"
printf 'Back up %s (it holds every secret) to your password manager or encrypted off-server storage.\n' "$SWW_CONFIG_DIR"
echo 'Operations, backups and upgrades: docs/DEPLOYMENT_VPS.md and docs/production-operations.md.'
