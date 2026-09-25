"""Diagnostic read-only /proc observer; never selected by production config."""
import json, os, sys
from pathlib import Path
v=json.loads(Path(sys.argv[1]).read_text());p=Path('/proc')/str(v['pid'])
assert os.readlink(p/'cwd')==v['cwd']
assert os.readlink(p/'exe')==v['executable']
assert (p/'stat').read_text().rsplit(')',1)[1].split()[19]==v['process_start']
print(json.dumps(v))
