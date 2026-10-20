#!/usr/bin/env python3
"""Record hashes of deployment files without copying private runtime values."""
import hashlib,json,os,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
files=[root/'docker-compose.prod.yml',root/'docker-compose.cloud.yml',*sorted((root/'docker').glob('compose.*.yml'))]
facts={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
output=root/'config/compose-files.json'
output.write_text(json.dumps(facts,sort_keys=True)+'\n')
os.chmod(output,0o600)
