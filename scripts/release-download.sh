#!/usr/bin/env bash
# Download only a published pinned runtime bundle, including from private forks.
set -euo pipefail
set +x
ROOT="${SWW_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$ROOT/scripts/spaceworks-workspace-repository.sh"
configure_release_repository
source "$ROOT/scripts/python-runtime.sh"
mode="${1:-}"
version="$mode"
metadata="$(mktemp)"; archive="$(mktemp)"
trap 'rm -f -- "$metadata" "$archive"' EXIT
headers() {
  [[ -z "${SWW_GITHUB_TOKEN:-}" ]] || printf 'header = "Authorization: Bearer %s"\n' "$SWW_GITHUB_TOKEN"
  printf 'header = "Accept: %s"\n' "$1"
}
if [[ "$mode" == --version-only ]]; then endpoint=latest
else
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ ]] || exit 64
  endpoint="tags/v$version"
fi
headers application/vnd.github+json | curl --config - -fsSL --proto '=https' --proto-redir '=https' --retry 3 \
  "https://api.github.com/repos/$SWW_REPOSITORY/releases/$endpoint" -o "$metadata"
if [[ "$mode" == --version-only ]]; then
  python3 - "$metadata" <<'PYCODE'
import json,re,sys
r=json.load(open(sys.argv[1]))
t=r.get('tag_name','')
if r.get('draft') is not False or r.get('prerelease') is not False or not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}',t):
    sys.exit('No eligible published main release.')
print(t[1:])
PYCODE
  exit 0
fi
selection="$(python3 - "$metadata" "$version" "$SWW_REPOSITORY" <<'PYCODE'
import json,sys
r=json.load(open(sys.argv[1]))
if r.get('tag_name')!='v'+sys.argv[2] or r.get('draft') is not False or r.get('prerelease') is not False:
    sys.exit('Not an eligible published release.')
expected=f'https://github.com/{sys.argv[3]}/releases/tag/v{sys.argv[2]}'
if r.get('html_url','').lower()!=expected.lower(): sys.exit('Wrong release repository.')
a=[a for a in r.get('assets',[]) if a.get('name')=='spaceworks-workspace-release.tar.gz']
if len(a)!=1 or not isinstance(a[0].get('id'),int): sys.exit('Runtime bundle is missing.')
print(a[0]['id'])
print(a[0].get('digest',''))
PYCODE
)"
asset_id="${selection%%$'\n'*}"
headers application/octet-stream | curl --config - -fsSL --proto '=https' --proto-redir '=https' --retry 3 \
  "https://api.github.com/repos/$SWW_REPOSITORY/releases/assets/$asset_id" -o "$archive"
python3 - "$archive" "${2:?Provide a destination}" "$selection" <<'PYCODE'
from pathlib import Path
import hashlib,sys,tarfile
archive,destination,selection=sys.argv[1:]
digest=selection.splitlines()[1:]
if digest and digest[0].startswith('sha256:'):
    if hashlib.file_digest(open(archive,'rb'),'sha256').hexdigest()!=digest[0][7:]: sys.exit('Bundle digest mismatch.')
root=Path(destination).resolve()
with tarfile.open(archive) as f:
    for m in f.getmembers():
        if not (root/m.name).resolve().is_relative_to(root) or not (m.isfile() or m.isdir()): sys.exit('Unsafe bundle member.')
    f.extractall(root,filter='data')
PYCODE
