#!/usr/bin/env python3
"""Capture TASK-103 checks and explicitly source-bound immediate-parent timings.

Run with Node 20 on PATH. Use a fresh artifact directory. All tests are attempted;
failures remain failures. Defaults compare HEAD to its immediate parent.
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
REGRESSION_TIMEOUT = 600
# Process budgets only: observed worker 331s and cadence 1085s, with >50% margin.
REGRESSION_BUDGETS = {
    'test-task106-self-play-workers': 600,
    'test-task104-training-cadence': 1800,
    'test-combat-full-training-verification': 3600,
    'test-combat-old-vs-new': 3600,
}
SMOKE_KEYS = ('AI_STAGE1_SMOKE_CHECKPOINT', 'AI_MAP_SMOKE_CHECKPOINT', 'AI_GAMESTART_SMOKE_CHECKPOINT')
CANONICAL_TIMEOUT = 3600


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO)


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def execute(dest, label, command, cwd, timeout, env=None, entry=None):
    logpath = dest / (label + '.log')
    with logpath.open('w', buffering=1) as log:
        log.write('COMMAND: ' + shlex.join(command) + '\nCWD: ' + str(cwd) + '\n')
        log.write('START_UTC: ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        log.write('OUTER_TIMEOUT_SECONDS: ' + str(timeout) + '\n')
        if env is not None:
            log.write('CHILD_ENVIRONMENT: ' + json.dumps({
                key: env.get(key) for key in ('PATH', 'NODE_PATH', 'NODE_OPTIONS') + SMOKE_KEYS
            }, sort_keys=True) + '\n')
        if entry is not None:
            log.write('DISPATCH_ENTRY: ' + json.dumps(entry, sort_keys=True) + '\n')
        log.flush()
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


def regression_entry(name, manifest):
    entry = manifest['commands'][name]
    assert entry['script'] == json.loads((REPO / 'package.json').read_text())['scripts'][name]
    assert entry['timeout_seconds'] >= REGRESSION_BUDGETS.get(name, REGRESSION_TIMEOUT)
    assert set(entry['environment']).issubset(SMOKE_KEYS)
    assert len(entry['environment']) <= 1, 'one native checkpoint per child'
    for filename, digest in entry['hashes'].items():
        assert sha(REPO / filename) == digest, 'changed prerequisite: ' + filename
    if entry['environment']:
        checkpoint = REPO / next(iter(entry['environment'].values()))
        for filename in ('model.json', 'weights.bin', 'metadata.json'):
            assert str((checkpoint / filename).relative_to(REPO)) in entry['hashes']
        metadata = json.loads((checkpoint / 'metadata.json').read_text())
        assert metadata['inputShapes'] == entry['input_shapes']
        assert metadata['afterHash'] == sha(checkpoint / 'weights.bin')
        assert metadata['trainingSeeds'] == entry['training_seeds']
        assert not set(entry['training_seeds']) & set(entry['evaluation_seeds'])
        assert metadata['beforeHash'] != metadata['afterHash'], 'checkpoint must be trained'
    env = dict(os.environ)
    for key in SMOKE_KEYS:
        env.pop(key, None)
    env.update({key: str((REPO / value).resolve()) for key, value in entry['environment'].items()})
    return entry, env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', required=True, type=Path)
    parser.add_argument('--mode', required=True, choices=['regression', 'canonical'])
    parser.add_argument('--after', default='HEAD', help='Committed revision to measure (default: HEAD)')
    parser.add_argument('--before', help='Immediate parent of --after (default: resolved --after^)')
    parser.add_argument('--manifest', type=Path, help='Frozen per-command regression inputs')
    parser.add_argument('--commands', nargs='+', help='Explicit subset; never an aggregate pass')
    args = parser.parse_args()
    if args.mode == 'regression' and not args.manifest:
        parser.error('regression requires --manifest; inherited smoke checkpoints are unsafe')
    if args.mode != 'regression' and (args.manifest or args.commands):
        parser.error('--manifest and --commands are regression-only')
    after = git('rev-parse', '--verify', args.after + '^{commit}').decode().strip()
    parent = git('rev-parse', '--verify', after + '^').decode().strip()
    before = git('rev-parse', '--verify', (args.before or parent) + '^{commit}').decode().strip()
    if before != parent:
        parser.error('--before must be the immediate parent of --after')
    dest = args.artifacts.resolve()
    dest.mkdir(parents=True, exist_ok=False)
    source_names = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')
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
        before=before, after=after, regression_timeout=REGRESSION_TIMEOUT,
        canonical_timeout=CANONICAL_TIMEOUT,
        interpretation='Explicit committed after revision versus its immediate parent; working-tree edits are not measured.'))
    save(dest / 'driver-sha256.json', {str(Path(__file__).resolve()): sha(Path(__file__))})
    runs = []
    if args.mode == 'regression':
        scripts = json.loads((REPO / 'package.json').read_text())['scripts']
        names = ['init-model', 'train'] + [name for name in scripts if name.startswith('test-')]
        manifest = json.loads(args.manifest.read_text())
        assert set(manifest['commands']) == set(names), 'manifest must cover every registered suite'
        save(dest / 'manifest.json', manifest)
        selected = args.commands or names
        assert len(set(selected)) == len(selected) and set(selected).issubset(names)
        save(dest / 'planned-suites.json', {name: scripts[name] for name in selected})
        for name in selected:
            entry, env = regression_entry(name, manifest)
            runs.append(execute(dest, name, ['npm', 'run', name], REPO,
                                entry['timeout_seconds'], env, entry))
            save(dest / 'runs.json', runs)
            # A command may write model output, but must not mutate its frozen inputs.
            regression_entry(name, manifest)
        save(dest / 'scope.json', dict(aggregate=args.commands is None,
             required=len(names), attempted=len(selected),
             interpretation='complete suite' if args.commands is None else 'subset only'))
    else:
        (dest / 'revision.diff').write_bytes(git('diff', before, after))
        observer = dest / 'observe-games.cjs'
        observer.write_bytes((Path(__file__).parent / 'task103-observe.cjs').read_bytes())
        manifests = {}
        for variant, revision in [('before', before), ('after', after)]:
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
            log.write(f'BEFORE_REVISION: {before}\nAFTER_REVISION: {after}\n')
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
