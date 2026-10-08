#!/usr/bin/env python3
"""Read-only candidate verification and isolated shipped-suite execution."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
from candidate import verify, runtime, rules

# Each live suite uses reliability/helpers/services: unique loopback ports,
# private generated keys outside the candidate, disposable mongod, owned cleanup.
SUITES = ['tests/online/lobby-start.test.js', 'tests/online/action-enforce-commit.test.js',
          'tests/server/undo-diff.test.js', 'tests/legacy_round.test.js']


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
    output.mkdir(parents=True, exist_ok=False)
    def suite(file):
        name = Path(file).stem
        evidence = output / name
        evidence.mkdir()
        child_env = dict(env, ONLINE_EVIDENCE_DIR=str(evidence),
                         DIPLOMACY_SIBLING_LOCK=str(evidence / 'sibling.lock'))
        args = [str(node), '--test', '--test-concurrency=1', '--test-reporter=tap', file]
        print('COMMAND ' + json.dumps(args), flush=True)
        # Run individual shipped suites: the general registry runner requires
        # Git metadata, deliberately absent from a deployable candidate.
        with (output / (name + '.log')).open('x') as log:
            log.write('COMMAND ' + json.dumps(args) + '\n'); log.flush()
            result = subprocess.run(args, cwd=root / 'diplomacy_server', env=child_env,
                                    stdout=log, stderr=subprocess.STDOUT)
            log.write('EXIT_STATUS=' + str(result.returncode) + '\n')
        print(('PASS ' if result.returncode == 0 else 'FAIL ') + file, flush=True)
        return result.returncode
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        results = list(pool.map(suite, SUITES))
    if any(results):
        raise RuntimeError('Isolated candidate checks failed')
    verify(root, json.loads(manifest.read_text()))
    print('PASS candidate lobby/auth action/undo/diff/replay old-format compatibility; isolated services owned cleanup')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('candidate', type=Path)
    p.add_argument('manifest', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--jobs', type=int, default=int(os.environ.get('TEST_JOBS', '6')))
    a = p.parse_args()
    check(a.candidate.resolve(), a.manifest.resolve(), a.output.resolve(), a.jobs)
