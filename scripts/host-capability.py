#!/usr/bin/env python3
"""Read-only host capability report, with no private configuration access."""
import json,platform,shutil,sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
print(json.dumps({'architecture':platform.machine(),'system':platform.system(),'freeBytes':shutil.disk_usage(root).free,'docker':bool(shutil.which('docker')),'systemd':Path('/run/systemd/system').is_dir(),'flock':bool(shutil.which('flock')),'python':platform.python_version()}))
