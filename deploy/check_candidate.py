#!/usr/bin/env python3
"""Read-only candidate verification and isolated shipped-suite execution."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from candidate import verify, runtime, rules



def check(root, manifest, output, jobs):
    verify(root, json.loads(manifest.read_text()))
    runtime(root / 'runtime')
    node = root / 'runtime/bin/node'
    rules(root, node)
    env = dict(os.environ, DIPLOMACY_CLIENT_ROOT=str(root / 'diplomacy'),
               PATH=str(node.parent) + ':' + os.environ['PATH'])
    # Never inherit a shared database or live smoke credentials.
    for name in list(env):
        if name.startswith(('RELIABILITY_', 'DIPLOMACY_SMOKE_', 'DIPLOMACY_TEST_', 'DIPLOMACY_LOCAL_')):
            env.pop(name)
    env['NODE_OPTIONS'] = '--require=' + str(root / 'diplomacy/deploy/candidate_tls.js')
    # Resolve the shared registry selection inside the package. This executor
    # validates every required TAP case/marker and works without Git metadata.
    args = [str(node), 'tests/helpers/runMultiplayerGate.js',
            'multiplayer-fast', str(output), '--jobs', str(jobs)]
    print('COMMAND ' + json.dumps(args), flush=True)
    subprocess.run(args, cwd=root / 'diplomacy_server', env=env, check=True)
    verify(root, json.loads(manifest.read_text()))
    print('PASS candidate multiplayer-fast; shared registered cases enforced; isolated services owned cleanup')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('candidate', type=Path)
    p.add_argument('manifest', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--jobs', type=int, default=int(os.environ.get('TEST_JOBS', '6')))
    a = p.parse_args()
    check(a.candidate.resolve(), a.manifest.resolve(), a.output.resolve(), a.jobs)
