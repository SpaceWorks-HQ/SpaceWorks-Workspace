#!/usr/bin/env bash
# Automatic deploys, for this workspace (explicit opt-in): installs GitHub's
# official Actions runner as a systemd service with the label
# spaceworks-workspace-prod. When a release is published, the Release workflow's
# deploy job runs `sudo /usr/local/sbin/sww-deploy v<version>` here; nothing
# connects in from GitHub.
#   install-runner.sh           install or re-register the runner
#   install-runner.sh --remove  unregister it and remove the service
# A repository-level runner accepts any workflow that names its label, so it
# runs as the unprivileged account sww-runner, without Docker access. Its only
# root command is the deploy wrapper, which installs verified, published main
# releases and nothing else.
set -euo pipefail
# Tokens must stay out of shell traces, argv, answer files and the runner's .env.
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
mode=install
case "${1:-}" in
  '') ;;
  --remove) mode=remove ;;
  *) die 'Usage: install-runner.sh [--remove]' ;;
esac
[[ $# -le 1 ]] || die 'Usage: install-runner.sh [--remove]'
require_root
require_tty
if [[ "$(uname -s)" != Linux ]] || ! command -v systemctl >/dev/null || [[ ! -d /run/systemd/system ]]; then
  die 'Automatic deploys need Linux with systemd running.'
fi
[[ -f "$(install_conf)" && -L "$SWW_DIR/current" ]] \
  || die "Automatic deploys need an installation made by the one-line installer in $SWW_DIR."
load_config_dir
# Keep an opt-in private-repository deploy credential only in the root-only config.
if [[ -n "${SWW_GITHUB_TOKEN:-}" && $mode = install ]]; then
  ( umask 077; printf '%s' "$SWW_GITHUB_TOKEN" > "$SWW_CONFIG_DIR/github-token" )
fi
RUNNER_USER=sww-runner
RUNNER_HOME=/var/lib/sww-runner
RUNNER_DIR=${SWW_RUNNER_DIR:-/opt/spaceworks-workspace-runner}
WRAPPER=/usr/local/sbin/sww-deploy
SUDOERS=/etc/sudoers.d/spaceworks-workspace-deploy
is_safe_path "$RUNNER_DIR" && [[ "$RUNNER_DIR" != "$SWW_DIR" && ! -L "$RUNNER_DIR" ]] || die 'Use a dedicated absolute runner directory.'
repository=${SWW_REPOSITORY:-$(conf_get "$(install_conf)" SWW_REPOSITORY)}
repository=${repository:-$SWW_DEFAULT_REPOSITORY}
is_repository "$repository" || die 'SWW_REPOSITORY must be a GitHub owner/name.'
if [[ $mode = remove && ! -f "$RUNNER_DIR/.runner" ]]; then
  rm -f "$SUDOERS" "$WRAPPER"
  say 'No configured runner to remove.'
  exit 0
fi

runner_token=''
read_token() {
  local purpose=$1
  printf '\nIn https://github.com/%s: Settings -> Actions -> Runners.\n' "$repository" >/dev/tty
  if [[ $purpose = registration ]]; then
    printf 'Choose New self-hosted runner and copy the short-lived token from its config.sh command.\n' >/dev/tty
  else
    printf 'Select this runner -> Remove and copy the short-lived removal token.\n' >/dev/tty
  fi
  printf '%s token (hidden): ' "$purpose" >/dev/tty
  IFS= read -r -s runner_token </dev/tty || die 'A terminal and token are required.'
  runner_token=${runner_token%$'\r'}
  printf '\n' >/dev/tty
  [[ "$runner_token" =~ ^[A-Za-z0-9_-]+$ ]] || die 'A non-empty GitHub runner token is required.'
}
configure_runner() (
  # The runner's supported secret-input variable: masked and consumed by config.sh.
  export ACTIONS_RUNNER_INPUT_TOKEN="$runner_token" HOME="$RUNNER_HOME"
  cd "$RUNNER_DIR"
  runuser -m -u "$RUNNER_USER" -- bash ./config.sh "$@"
)
unregister() {
  read_token removal
  cd "$RUNNER_DIR"
  if [[ -f .service ]]; then bash ./svc.sh stop; bash ./svc.sh uninstall; fi
  configure_runner remove
  runner_token=''
}

if [[ $mode = remove ]]; then
  unregister
  rm -f "$SUDOERS" "$WRAPPER"
  say 'Runner registration, service and deploy permission removed; its files were kept. Delete the SWW_DEPLOY variable on GitHub too.'
  exit 0
fi

command -v python3 >/dev/null || install_packages python3
command -v sudo >/dev/null || install_packages sudo
for binary in curl tar sha256sum python3 sudo runuser; do
  command -v "$binary" >/dev/null || die "Missing $binary. Install it, then rerun."
done
case $(uname -m) in
  x86_64|amd64) architecture=x64 ;;
  aarch64|arm64) architecture=arm64 ;;
  *) die 'The runner supports only Linux x64 and arm64.' ;;
esac
temporary=$(mktemp -d)
trap 'runner_token=""; rm -rf -- "$temporary"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 600 \
  https://api.github.com/repos/actions/runner/releases/latest -o "$temporary/release.json"
selection=$(python3 "$source_dir/scripts/runner-release.py" "$architecture" < "$temporary/release.json") \
  || die 'Could not verify the official runner release metadata.'
url=${selection%%$'\n'*}
checksum=${selection##*$'\n'}
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 600 \
  "$url" -o "$temporary/runner.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/runner.tar.gz" | sha256sum --check --status \
  || die 'Runner SHA-256 mismatch; nothing was unpacked or registered.'
# An account with no Docker group and no other sudo rights.
id "$RUNNER_USER" >/dev/null 2>&1 \
  || useradd --system --home-dir "$RUNNER_HOME" --create-home --shell /bin/bash "$RUNNER_USER"
if id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -qx docker; then
  die "$RUNNER_USER must not be in the docker group (it would be root). Remove it, then rerun."
fi
install -d -m 0700 -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
if [[ -f "$RUNNER_DIR/.runner" ]]; then
  say 'Re-registering replaces the existing registration, which needs its removal token first.'
  unregister
fi
read_token registration
tar -xzf "$temporary/runner.tar.gz" --no-same-owner -C "$RUNNER_DIR"
[[ -f "$RUNNER_DIR/config.sh" ]] || die 'The official runner archive is incomplete.'
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
# The archive resets the directory mode; the registration credentials live here.
chmod 0700 "$RUNNER_DIR"
[[ ! -f "$RUNNER_DIR/bin/installdependencies.sh" ]] || bash "$RUNNER_DIR/bin/installdependencies.sh" >/dev/null
configure_runner --url "https://github.com/$repository" --name "$(hostname)-spaceworks-workspace" \
  --labels spaceworks-workspace-prod --unattended --replace
runner_token=''
[[ -f "$RUNNER_DIR/svc.sh" ]] || die 'Runner configuration did not create its service helper.'

# The single root command the runner may run: deploy a verified published release.
cat > "$WRAPPER.new" <<EOF
#!/bin/sh
# Installed by install-runner.sh. The GitHub Actions deploy job runs this through
# sudo; vps-deploy.sh accepts only published, non-pre-release releases on main.
exec /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
  SWW_DIR='$SWW_DIR' SWW_CONFIG_DIR='$SWW_CONFIG_DIR' /bin/bash '$SWW_DIR/current/scripts/vps-deploy.sh' "\$@"
EOF
chown 0:0 "$WRAPPER.new"
chmod 0755 "$WRAPPER.new"
mv -f "$WRAPPER.new" "$WRAPPER"
printf '%s ALL=(root) NOPASSWD: %s\n' "$RUNNER_USER" "$WRAPPER" > "$SUDOERS.new"
chmod 0440 "$SUDOERS.new"
if command -v visudo >/dev/null; then visudo -cqf "$SUDOERS.new" || { rm -f "$SUDOERS.new"; die 'The sudoers rule did not validate.'; }; fi
mv -f "$SUDOERS.new" "$SUDOERS"

cd "$RUNNER_DIR"
[[ -f .service ]] || bash ./svc.sh install "$RUNNER_USER"
bash ./svc.sh start
cat <<EOF

Runner installed as the systemd service of $RUNNER_USER. Finish in GitHub repository $repository:
1. Settings -> Secrets and variables -> Actions -> Variables -> New repository variable:
   SWW_DEPLOY = true
2. Settings -> Environments -> New environment "production" -> Deployment branches and
   tags: Selected branches -> main (optionally add required reviewers).
3. Settings -> Actions -> General -> Fork pull request workflows:
   Require approval for all external contributors.
4. Settings -> Actions -> Runners: this runner is Idle with the label spaceworks-workspace-prod.
From then on, every published release (a VERSION bump reaching main) deploys here: a
backup, the update, health checks, and the previous release restored if it fails.
SECURITY: a repository runner accepts any workflow that names its label, so anyone who can
push workflows can run code here as $RUNNER_USER. That account has no Docker access and can
run only $WRAPPER as root, which installs only published, non-pre-release releases on main.
Keep repository write access to trusted maintainers. Runner updates stay automatic.
Remove it with the installer's menu (7) or: sudo bash $SWW_DIR/current/scripts/install-runner.sh --remove
EOF
