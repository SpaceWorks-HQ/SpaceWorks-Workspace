#!/usr/bin/env python3
"""Atomic edit of one non-secret installation selector."""
from pathlib import Path
import os
import re
import sys
path, key, value = sys.argv[1:]
if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or not re.fullmatch(r'[A-Za-z0-9_.:/-]+', value):
    sys.exit('Unsafe configuration selector.')
target = Path(path)
lines = [line for line in target.read_text().splitlines() if not line.startswith(key + '=')]
lines.append(f"{key}='{value}'")
temporary = target.with_suffix('.new')
with temporary.open('x') as handle:
    os.chmod(temporary, 0o600)
    handle.write('\n'.join(lines) + '\n')
    handle.flush()
    os.fsync(handle.fileno())
temporary.replace(target)
