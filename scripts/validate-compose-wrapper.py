#!/usr/bin/env python3
"""Check owner-only configuration permissions without reading secret contents."""
import os,stat,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
for path in [root/'.env',*sorted((root/'config').glob('*.env'))]:
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode & 0o077:
        sys.exit('Configuration must be an owner-only regular file belonging to the install owner.')
