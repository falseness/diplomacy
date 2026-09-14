#!/usr/bin/env python3
"""Apply TASK-124's companion server change from the single game-repo commit."""
from pathlib import Path
import subprocess
import sys

server = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'diplomacy_server'
patch = Path(__file__).with_name('coop-scaled-matchmaking-server.patch').resolve()
command = ['git', '-C', str(server), 'apply']
if subprocess.run(command + ['--reverse', '--check', str(patch)], capture_output=True).returncode == 0:
    print('PASS TASK-124 server patch already applied')
else:
    subprocess.run(command + ['--check', str(patch)], check=True)
    subprocess.run(command + [str(patch)], check=True)
    print('PASS TASK-124 server patch applied')
