#!/usr/bin/env python3
"""Apply the companion co-op matchmaking server change from the game repository.

TASK-124 introduced the patch (version-3 generation); TASK-142 revised it for
version-4 Divided Valley generation and TASK-155 added typed portal validation.
A checkout with a previous revision applied is upgraded by reversing that
revision before applying the current one.
"""
from pathlib import Path
import subprocess
import sys

# Game commits carrying earlier patch revisions, newest first.
PREVIOUS_REVISIONS = ['9f9802e', '67bd75e']  # version-4 untyped portals, version-3
game = Path(__file__).resolve().parents[1]
server = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else game.parent / 'diplomacy_server'
patch = Path(__file__).with_name('coop-scaled-matchmaking-server.patch').resolve()
command = ['git', '-C', str(server), 'apply']


def check(args, stdin=None):
    return subprocess.run(command + args, input=stdin, capture_output=True).returncode == 0


if check(['--reverse', '--check', str(patch)]):
    print('PASS co-op matchmaking server patch already applied')
    sys.exit(0)
for revision in PREVIOUS_REVISIONS:
    previous = subprocess.run(['git', '-C', str(game), 'show', revision + ':ops/' + patch.name],
                              capture_output=True, check=True).stdout
    if not check(['--check', str(patch)]) and check(['--reverse', '--check', '-'], previous):
        subprocess.run(command + ['--reverse', '-'], input=previous, check=True)
        print(f'PASS previous server patch revision {revision} reversed')
        break
subprocess.run(command + ['--check', str(patch)], check=True)
subprocess.run(command + [str(patch)], check=True)
print('PASS co-op matchmaking server patch applied')
