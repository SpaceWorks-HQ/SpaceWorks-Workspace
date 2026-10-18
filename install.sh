#!/usr/bin/env bash
# Space Works Workspace installer for a Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/<ref>/install.sh -o install.sh
#   sudo bash install.sh --ref <reviewed-commit-or-tag>
#
# Resolves the ref to one commit, downloads that exact source tarball into
# <directory>/releases/<commit>, then runs its guided setup (first install) or
# its updater (--update). <directory>/current points at the active release
# only after setup or the update succeeded.
#
# Options:
#   --ref REF            commit, tag or branch to install (default: main)
#   --directory DIR      installation directory (default: /opt/spaceworks-workspace)
#   --update             upgrade an existing installation, keeping its configuration
#   --repository O/R     GitHub repository (default: SpaceWorks-HQ/SpaceWorks-Workspace)
# A private repository needs a read-only token in SWW_GITHUB_TOKEN (fine-grained,
# "Contents: read"); it is sent only to api.github.com and never stored.
# Unattended (cloud-init): SWW_NONINTERACTIVE=1 plus the answers listed in
# scripts/setup-vps.sh.
set -euo pipefail
set +x
ref=main
install_dir=/opt/spaceworks-workspace
repository=SpaceWorks-HQ/SpaceWorks-Workspace
update=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref=${2:?Provide a reviewed commit or tag}; shift 2 ;;
    --directory) install_dir=${2:?Provide an absolute installation directory}; shift 2 ;;
    --repository) repository=${2:?Provide OWNER/REPOSITORY}; shift 2 ;;
    --update) update=1; shift ;;
    --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$ && "$ref" != *..* ]] || { echo 'Invalid release reference.' >&2; exit 1; }
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid repository.' >&2; exit 1; }
[[ "$install_dir" = /* && "$install_dir" != / && "$install_dir" != *[[:space:]:]* ]] || { echo 'Use an absolute installation directory without spaces or colons.' >&2; exit 1; }
if [[ "${SWW_NONINTERACTIVE:-0}" != 1 && ! -t 0 ]]; then
  # Piped into bash: the script arrives on stdin, so prompts read the terminal.
  exec </dev/tty || { echo 'No terminal available. Set SWW_NONINTERACTIVE=1 for unattended installs.' >&2; exit 1; }
fi
for dependency in curl tar sed; do command -v "$dependency" >/dev/null || { echo "Install $dependency first." >&2; exit 1; }; done
[[ $(uname -s) = Linux ]] || { echo 'Run this installer on the Linux server.' >&2; exit 1; }
[[ ! -e "$install_dir/current" || "$update" = 1 ]] || { echo 'An installation exists here. Use --update to upgrade it.' >&2; exit 1; }
[[ -e "$install_dir/current" || "$update" = 0 ]] || { echo "No installation at $install_dir to update." >&2; exit 1; }

token=${SWW_GITHUB_TOKEN:-}
github() {
  # The token travels in a curl config on a file descriptor, never in argv.
  if [[ -n "$token" ]]; then
    curl --fail --show-error --silent --location --proto '=https' --config <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$@"
  else
    curl --fail --show-error --silent --location --proto '=https' "$@"
  fi
}

# Resolve once, so the archive and the version label always name one commit.
revision=$(github --header 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$repository/commits/$ref") \
  || { echo 'Could not resolve the release. For a private repository, set SWW_GITHUB_TOKEN.' >&2; exit 1; }
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Could not resolve the release commit.' >&2; exit 1; }
printf 'Space Works Workspace release: %s (%s)\nInstall directory: %s\n' "$revision" "$ref" "$install_dir"
if [[ "${SWW_NONINTERACTIVE:-0}" != 1 ]]; then
  read -r -p 'Download this release and continue? [y/N]: ' proceed
  [[ "$proceed" = y || "$proceed" = Y ]] || exit 0
fi

release_dir="$install_dir/releases/$revision"
if [[ ! -e "$release_dir" ]]; then
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' EXIT
  github "https://api.github.com/repos/$repository/tarball/$revision" -o "$scratch/source.tar.gz"
  mkdir "$scratch/source"
  tar -xzf "$scratch/source.tar.gz" -C "$scratch/source" --strip-components=1
  printf '%s\n' "$revision" > "$scratch/source/.release"
  mkdir -p "$install_dir/releases"
  mv "$scratch/source" "$release_dir"
else
  echo 'This release was downloaded before; reusing it.'
fi

export SWW_INSTALL_DIR=$install_dir
if [[ "$update" = 1 ]]; then
  SWW_PREVIOUS_RELEASE=$(readlink -f "$install_dir/current") bash "$release_dir/scripts/update-vps.sh"
else
  bash "$release_dir/scripts/setup-vps.sh"
fi
ln -sfn "$release_dir" "$install_dir/current.new"
mv -Tf "$install_dir/current.new" "$install_dir/current"
printf '\nActive release: %s/current -> %s\n' "$install_dir" "$revision"
echo "Operator commands run from $install_dir/current (scripts/vps-compose.sh, vps-backup.sh, ...)."
