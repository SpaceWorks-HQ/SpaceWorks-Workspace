#!/usr/bin/env python3
"""Copy continuity-key assignments literally; never execute a dotenv file."""
from pathlib import Path
import os
import sys
KEYS = {'AUTH_SECRET', 'MFA_ENCRYPTION_KEY', 'INTEGRATION_ENCRYPTION_KEY', 'VAULT_MASTER_KEY', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'}
source, target = map(Path, sys.argv[1:])
values = {line.partition('=')[0]: line for line in source.read_text().splitlines() if line.partition('=')[0] in KEYS}
if set(values) != KEYS:
    sys.exit('Archive lacks continuity keys; app remains offline.')
lines = [line for line in target.read_text().splitlines() if line.partition('=')[0] not in KEYS]
temporary = target.with_suffix('.restore-new')
with temporary.open('x') as handle:
    os.chmod(temporary, 0o600)
    handle.write('\n'.join(lines + list(values.values())) + '\n')
    handle.flush()
    os.fsync(handle.fileno())
temporary.replace(target)
