#!/usr/bin/env python3
"""Checksummed archive boundary. Reject links, traversal and unexpected files."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

def facts(root):
    entries = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Archive links are forbidden.')
        if path.is_file() and path.relative_to(root).as_posix() != 'manifest.json':
            digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
            entries[path.relative_to(root).as_posix()] = digest
    return entries

def main():
    action, source = sys.argv[1:3]
    root = Path(source).resolve()
    if action == 'extract':
        root = Path(sys.argv[3]).resolve()
        with tarfile.open(source) as archive:
            members = archive.getmembers()
            if len(members) > 1_000_000:
                raise ValueError('Too many archive members.')
            for member in members:
                path = (root / member.name).resolve()
                if not path.is_relative_to(root) or not (member.isfile() or member.isdir()):
                    raise ValueError('Unsafe archive member.')
            archive.extractall(root, filter='data')
        action = 'verify'
    if action == 'create':
        (root / 'manifest.json').write_text(json.dumps({'format': 1, 'files': facts(root)}, sort_keys=True))
    elif action == 'verify':
        document = json.loads((root / 'manifest.json').read_text())
        if document.get('format') != 1 or document.get('files') != facts(root):
            raise ValueError('Archive checksum verification failed.')
        if not (root / 'database.dump').is_file() or not (root / 'config/app.env').is_file():
            raise ValueError('Incomplete deployment archive.')
    else:
        raise ValueError('Use create, extract or verify.')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, tarfile.TarError):
        sys.exit('Backup validation failed. Nothing was restored.')
