#!/usr/bin/env python3
"""Capture TASK-103 checks and the original change's immediate-parent timings.

Run with Node 20 on PATH. Use a fresh artifact directory. All tests are attempted;
failures remain failures. Historical timings do not measure later task changes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shlex
import signal
import statistics
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]
BEFORE = 'd03d37a4d6d6d32b0de37e187ff29dece7bde35f'
AFTER = '94a8d8e691d05a102d4e2af49938839bc4cb9465'
REGRESSION_TIMEOUT = 300
CANONICAL_TIMEOUT = 3600


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO)


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def execute(dest, label, command, cwd, timeout, env=None):
    logpath = dest / (label + '.log')
    with logpath.open('w', buffering=1) as log:
        log.write('COMMAND: ' + shlex.join(command) + '\nCWD: ' + str(cwd) + '\n')
        log.write('START_UTC: ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        start = time.monotonic()
        process = subprocess.Popen(command, cwd=cwd, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True, env=env)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code = 124
            log.write(f'TIMEOUT: FAIL exceeded {timeout}s; unfinished, not a pass\n')
        seconds = time.monotonic() - start
        log.write(f'EXIT_CODE: {code}\nELAPSED_WALL_SECONDS: {seconds:.6f}\n')
    record = dict(label=label, command=command, cwd=str(cwd), exit_code=code,
                  seconds=seconds, log=str(logpath), sha256=sha(logpath))
    print(json.dumps(record), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', required=True, type=Path)
    parser.add_argument('--mode', required=True, choices=['regression', 'canonical'])
    args = parser.parse_args()
    dest = args.artifacts.resolve()
    dest.mkdir(parents=True, exist_ok=False)
    source_names = git('ls-files', '-z').decode().split('\0')
    source_hashes = {name: sha(REPO / name) for name in source_names if name}
    save(dest / 'host-source-sha256.json', source_hashes)
    (dest / 'host.diff').write_bytes(git('diff'))
    save(dest / 'environment.json', dict(
        host_revision=git('rev-parse', 'HEAD').decode().strip(),
        status=git('status', '--short').decode(), platform=platform.platform(),
        cpu=Path('/proc/cpuinfo').read_text(), node=subprocess.check_output(
            ['node', '--version'], text=True).strip(),
        environment={k: v for k, v in os.environ.items()
                     if k in ('PATH', 'NODE_PATH', 'NODE_OPTIONS') or k.startswith(('TF_', 'OMP_', 'DIPLOMACY_'))},
        before=BEFORE, after=AFTER, regression_timeout=REGRESSION_TIMEOUT,
        canonical_timeout=CANONICAL_TIMEOUT,
        interpretation='Historical original TASK-103 change versus its immediate parent; not current HEAD training throughput.'))
    save(dest / 'driver-sha256.json', {str(Path(__file__).resolve()): sha(Path(__file__))})
    runs = []
    if args.mode == 'regression':
        scripts = json.loads((REPO / 'package.json').read_text())['scripts']
        names = ['init-model', 'train'] + [name for name in scripts if name.startswith('test-')]
        save(dest / 'planned-suites.json', {name: scripts[name] for name in names})
        for name in names:
            runs.append(execute(dest, name, ['npm', 'run', name], REPO, REGRESSION_TIMEOUT))
            save(dest / 'runs.json', runs)
        runs.append(execute(dest, 'predict-speed', ['npm', 'run', 'benchmark-model-predict-batching',
                                                  '--', '1000', '48', '3'], REPO, REGRESSION_TIMEOUT))
    else:
        assert git('rev-parse', AFTER + '^').decode().strip() == BEFORE
        (dest / 'revision.diff').write_bytes(git('diff', BEFORE, AFTER))
        observer = dest / 'observe-games.cjs'
        observer.write_bytes((Path(__file__).parent / 'task103-observe.cjs').read_bytes())
        manifests = {}
        for variant, revision in [('before', BEFORE), ('after', AFTER)]:
            source = dest / (variant + '-source')
            subprocess.run(['git', 'clone', '--quiet', '--shared', '--no-checkout',
                            str(REPO), str(source)], check=True)
            subprocess.run(['git', 'checkout', '--quiet', '--detach', revision], cwd=source, check=True)
            names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=source).decode().split('\0')
            manifests[variant] = {name: sha(source / name) for name in names if name}
            (source / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
        save(dest / 'source-sha256.json', manifests)
        for repeat in range(1, 4):
            order = ['before', 'after'] if repeat % 2 else ['after', 'before']
            for variant in order:
                label = f'canonical-{variant}-{repeat}'
                command = ['./train.sh', '--storage-dir', str(dest / label),
                           '--run-id', 'task103-canonical', '--games', '15', '--epochs', '1',
                           '--seed', '87087', '--old-vs-new-games', '2', '--plateau-window', '2',
                           '--plateau-min-delta', '2', '--curriculum-lr-reduction-attempted']
                env = dict(os.environ)
                env['NODE_OPTIONS'] = env.get('NODE_OPTIONS', '') + ' --require=' + str(observer)
                env['TASK103_OUTCOMES'] = str(dest / (label + '-outcomes.jsonl'))
                record = execute(dest, label, command, dest / (variant + '-source'), CANONICAL_TIMEOUT, env)
                record['variant'] = variant
                runs.append(record)
                save(dest / 'runs.json', runs)
        medians = {v: statistics.median(r['seconds'] for r in runs if r['variant'] == v)
                   for v in ['before', 'after']}
        reduction = 100 * (1 - medians['after'] / medians['before'])
        passed = all(r['exit_code'] == 0 for r in runs) and reduction >= 10
        with (dest / 'canonical-training-speed.log').open('w') as log:
            log.write(f'BEFORE_REVISION: {BEFORE}\nAFTER_REVISION: {AFTER}\n')
            for record in runs:
                log.write(json.dumps(record) + '\n')
            log.write(f'T_BEFORE_MEDIAN_SECONDS: {medians["before"]:.6f}\n'
                      f'T_AFTER_MEDIAN_SECONDS: {medians["after"]:.6f}\nREDUCTION_PERCENT: {reduction:.6f}\n'
                      f'SPEED_GATE: {"PASS" if passed else "FAIL"} required >=10 percent\n')
        save(dest / 'checkpoint-sha256.json', {
            str(p.relative_to(dest)): sha(p) for p in dest.glob('canonical-*/**/*')
            if p.is_file() and p.name in ('model.json', 'weights.bin', 'metadata.json')})
        for variant, hashes in manifests.items():
            assert all(sha(dest / (variant + '-source') / name) == value for name, value in hashes.items())
    save(dest / 'runs.json', runs)
    assert all(sha(REPO / name) == value for name, value in source_hashes.items())
    failures = [r['label'] for r in runs if r['exit_code'] != 0]
    if args.mode == 'canonical' and not passed:
        failures.append('canonical-speed-gate')
    (dest / 'audit.log').write_text('FROZEN_SOURCE: PASS\n' +
        f'COMMANDS: {len(runs)}\nFAILURES: {json.dumps(failures)}\n')
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
