#!/usr/bin/env python3
"""Archive the fixed 20-minute invariant run without changing the test runtime."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'artifacts' / 'TASK-098'
STRESS_MS = 1_200_000
SEED_START = 98000


def output(command):
    return subprocess.check_output(command, cwd=ROOT, text=True).strip()


def source_hashes():
    paths = output(['git', 'ls-files']).splitlines()
    paths.append(str(Path(__file__).relative_to(ROOT)))
    return {
        name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        for name in sorted(set(paths))
        if not name.startswith('artifacts/') and (ROOT / name).is_file()
    }


def main():
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    report = ARCHIVE / 'stress-report.json'
    log_path = ARCHIVE / 'stress-verification.log'
    assert not report.exists() and not log_path.exists(), 'Preserve prior attempts'
    command = [
        'npm', 'run', 'test-fast-generated-map-invariants', '--',
        '--stress-ms', str(STRESS_MS), '--seed-start', str(SEED_START),
        '--report-name', os.path.relpath(report, '/mnt/storage/diplomacy/benchmarks')
    ]
    before = source_hashes()
    provenance = {
        'command': command, 'cwd': str(ROOT),
        'commit': output(['git', 'rev-parse', 'HEAD']),
        'dirtyStatus': output(['git', 'status', '--short', '--untracked-files=all']),
        'node': output(['node', '--version']), 'npm': output(['npm', '--version']),
        'platform': platform.platform(), 'python': platform.python_version(),
        'environment': {key: value for key, value in os.environ.items()
                        if key.startswith(('FAST_INVARIANT_', 'NODE_', 'OMP_', 'TF_'))
                        or key in ('PATH', 'LANG', 'TZ')},
        'sourceHashes': before,
    }
    (ARCHIVE / 'run-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    with log_path.open('x') as log:
        log.write(json.dumps({key: value for key, value in provenance.items()
                              if key != 'sourceHashes'}, indent=2) + '\n')
        log.write('COMMAND: ' + shlex.join(command) + '\n')
        log.flush()
        start = time.monotonic()
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        elapsed = time.monotonic() - start
        unchanged = before == source_hashes()
        log.write('\nEXIT_CODE: ' + str(result.returncode) + '\n')
        log.write('ELAPSED_SECONDS: ' + str(elapsed) + '\n')
        log.write('FROZEN_SOURCE_MATCH: ' + str(unchanged) + '\n')
    assert result.returncode == 0, 'Invariant run failed; see complete log'
    assert unchanged, 'Source changed during run'
    data = json.loads(report.read_text())
    assert data['runtimeMs'] >= STRESS_MS
    assert len(set(data['seeds'])) == data['seedCount']
    assert all(data[key] == 0 for key in (
        'vectorMismatches', 'undoMismatches', 'gridRestorationMismatches'))
    provenance.update(elapsedSeconds=elapsed, exitCode=result.returncode,
                      reportSha256=hashlib.sha256(report.read_bytes()).hexdigest())
    (ARCHIVE / 'run-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print('TASK-098 archived stress verification PASS', flush=True)


if __name__ == '__main__':
    main()
