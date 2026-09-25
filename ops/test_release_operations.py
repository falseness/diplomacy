"""Separate fixture entry point; never imported by the production gate."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shlex
import tarfile
import sys
import time

from test_prepare_runtime_bundle import RuntimeBundle
from test_prepare_rollback import RetainRollback


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(exist_ok=False)
    started = int(time.time() * 1000)
    cases = ['missing-map', 'complete', 'tampered-receipt', 'changed-observation',
             'missing-smoke-adapter', 'expired-smoke', 'tampered-archive', 'tampered-rehearsal']
    (output / 'verification-plan.json').write_text(json.dumps({
        'scope': 'helper-to-operation boundary diagnostics only', 'fullTaskPass': False,
        'cases': cases, 'tier': 'source-executed isolated fixtures; no public authentication',
        'estimateMs': 60000, 'stopAtMs': started + 3300000,
        'commands': ['python3 ops/test_release_operations.py <fresh-output>',
                     'node20 ops/test_release_operations.js <fixture-options>'],
        'exclusions': ['production staging', 'real host authentication', 'public/browser smoke', 'activation']}, indent=2) + '\n')
    runtime, prior = RuntimeBundle(), RetainRollback()
    runtime.setUp()
    prior.setUp()
    try:
        config = {'client': str(runtime.fixture.client), 'server': str(runtime.fixture.server),
                  'sources': str(runtime.fixture.evidence), 'runtime': str(runtime.runtime),
                  'dependencies': str(runtime.dependencies), 'runtimeReceipt': str(runtime.receipt),
                  'rollbackRoots': {k: str(v) for k, v in prior.roots.items()},
                  'observationFile': str(prior.evidence), 'observationSha256': prior.digest,
                  'observerArgv': [sys.executable, '-c', 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).read_text())', str(prior.evidence)]}
        options = {'config': config, 'outputDir': str(output), 'startedMs': started,
                   'sentinel': str(prior.database), 'cases': cases}
        fixture_hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                          for root in (runtime.root, prior.root) for p in root.rglob('*')
                          if p.is_file() and '.git' not in p.parts}
        (output / 'fixture-identities.json').write_text(json.dumps(fixture_hashes, indent=2) + '\n')
        command = ['/usr/local/bin/node20', str(Path(__file__).with_suffix('.js')), json.dumps(options)]
        print('COMMAND ' + shlex.join(command) + ' CWD=' + os.getcwd(), flush=True)
        result = subprocess.run(command, timeout=max(1, (started + 3300000) / 1000 - time.time()))
        print('ACTUAL_EXIT=' + str(result.returncode), flush=True)
        assert result.returncode == 0, 'boundary comparison failed'
        with tarfile.open(output / 'complete/candidate/candidate.tar.gz') as archive:
            assert sorted(archive.getnames()) == ['diplomacy/game.js', 'diplomacy/index.html',
                'diplomacy/unused.js', 'diplomacy_server/server/loadGameCode.js',
                'diplomacy_server/server/package-lock.json', 'diplomacy_server/server/package.json']
            assert archive.extractfile('diplomacy/game.js').read() == b'const version = 1;'
        with tarfile.open(output / 'complete/candidate/runtime-dependencies.tar.gz') as archive:
            assert len(archive.getnames()) == 9
            assert archive.extractfile('runtime/bin/node').read() == b'synthetic executable bytes; never executed'
            assert archive.getmember('diplomacy_server/server/node_modules/.bin/example').linkname == '../example/bin.js'
        with tarfile.open(output / 'complete/rollback/prior-installation.tar.gz') as archive:
            assert len(archive.getnames()) == 16
            assert archive.extractfile('server/server/index.js').read() == b'prior-server'
            assert archive.extractfile('server/server/node_modules/pkg/index.js').read() == b'prior dependency'
        print('PASS independent archive readback source=6 runtime=9 rollback=16 exact bytes and safe link', flush=True)
        for file, digest in fixture_hashes.items():
            assert hashlib.sha256(Path(file).read_bytes()).hexdigest() == digest, file
        print('PASS identical input fixture bytes preserved; unrelated games unchanged', flush=True)
    finally:
        runtime.doCleanups()
        prior.doCleanups()
        removed = not runtime.root.exists() and not prior.root.exists()
        (output / 'fixture-cleanup.json').write_text(json.dumps({'cleanup': removed}) + '\n')
        assert removed
    print('PASS fixture cleanup=true FULL_TASK_PASS=false RELEASE_READY=false', flush=True)


if __name__ == '__main__':
    main()
