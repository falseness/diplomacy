#!/usr/bin/env python3
"""Finite canonical phase experiment; never a speed acceptance measurement."""
import argparse
import difflib
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import time

ORDER = ('off', 'on', 'on', 'off')
OWNERSHIP_ORDER = ('control', 'reversal', 'reversal', 'control')
UNDO_PATH = 'ai/mutableVectorGrid.js'
UNDO_CAPTURE = 'vector: mutableGrid.cells[coord.x][coord.y]'
BASELINE = Path('/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training')
HEAP_MIB = 6144


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node-bin', type=Path, required=True)
    parser.add_argument('--ownership-reversal', action='store_true',
                        help='Isolate undo-vector copying with observation on in all four runs')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    output.mkdir(parents=True)  # No overwrites or replacement repetitions.
    git = lambda *args: subprocess.check_output(['git', *args], cwd=repo)
    revision = git('rev-parse', 'HEAD').decode().strip()
    source = output / 'source'
    source.mkdir()
    with tarfile.open(fileobj=io.BytesIO(git('archive', revision))) as archive:
        archive.extractall(source)
    hashes = {str(p.relative_to(source)): digest(p) for p in source.rglob('*') if p.is_file()}
    (source / 'node_modules').symlink_to(repo / 'node_modules', target_is_directory=True)
    order = OWNERSHIP_ORDER if args.ownership_reversal else ORDER
    reversal_hashes = None
    if args.ownership_reversal:
        reversal = output / 'source-reversal'
        shutil.copytree(source, reversal, symlinks=True)
        original = (source / UNDO_PATH).read_text()
        assert original.count(UNDO_CAPTURE) == 1
        assert UNDO_CAPTURE + '.slice()' not in original
        changed = original.replace(UNDO_CAPTURE, UNDO_CAPTURE + '.slice()')
        (reversal / UNDO_PATH).write_text(changed)
        reversal_hashes = dict(hashes, **{UNDO_PATH: digest(reversal / UNDO_PATH)})
        (output / 'mechanism.diff').write_text(''.join(difflib.unified_diff(
            original.splitlines(True), changed.splitlines(True),
            fromfile='control/' + UNDO_PATH, tofile='reversal/' + UNDO_PATH)))
    hook = output / 'observe.cjs'
    shutil.copyfile(Path(__file__).with_suffix('.cjs'), hook)
    shutil.copyfile(__file__, output / 'driver.py')
    baseline_hashes = {str(p.relative_to(BASELINE)): digest(p) for p in BASELINE.rglob('*') if p.is_file()}
    assert baseline_hashes and 'model.json' in baseline_hashes
    shutil.copytree(BASELINE, output / 'baseline-frozen')
    env = dict(os.environ)
    env['PATH'] = str(args.node_bin.resolve()) + os.pathsep + env['PATH']
    env['NODE_PATH'] = '/usr/share/nodejs'
    env['NODE_OPTIONS'] = f'--max-old-space-size={HEAP_MIB} --require={hook}'
    assert not any(k.startswith('DIPLOMACY_') for k in env), 'unexpected policy override'
    commands = []
    for index, mode in enumerate(order, 1):
        dest = output / f'run-{index}-{mode}'
        dest.mkdir()
        commands.append(['./train.sh', '--storage-dir', str(dest / 'storage'),
                         '--run-id', 'task102-canonical', '--games', '15', '--epochs', '1',
                         '--seed', '87087', '--old-vs-new-games', '2', '--plateau-window', '2',
                         '--plateau-min-delta', '2', '--curriculum-lr-reduction-attempted'])
    write(output / 'predeclared.json', dict(revision=revision, tree=git('rev-parse', 'HEAD^{tree}').decode().strip(),
          status=git('status', '--short').decode(), order=order, commands=commands,
          experiment='ownership-reversal' if args.ownership_reversal else 'observation',
          reversal_sources=reversal_hashes,
          sources=hashes, hook_sha256=digest(hook), driver_sha256=digest(output / 'driver.py'),
          baseline=str(BASELINE), baseline_hashes=baseline_hashes,
          node=subprocess.check_output(['node', '--version'], env=env, text=True).strip(),
          dependencies=subprocess.check_output(['node', '-e', 'console.log(JSON.stringify(require("@tensorflow/tfjs-node").version))'], cwd=source, env=env, text=True).strip(),
          platform=platform.platform(), environment={k: env[k] for k in ('PATH', 'NODE_PATH', 'NODE_OPTIONS')},
          boundaries='Single-worker nested intervals; parent exclusive = inclusive minus immediate children. GC clipped/unioned overlap, never additive. Node startup to main entry; process bootstrap/shutdown = external wall minus Node monotonic lifetime; residual includes unobserved preparation and common semantic serialization. Retention counts are live batch/metric counts at boundaries, cumulative teacher counts are explicitly not live retained examples.',
          semantics='All game results, teacher examples/labels, fit histories and model outputs retained. Common semantic observation in all four runs. Ownership experiment observes all arms and changes only undo capture copying; default experiment only toggles coarse timing/memory/GC. Actual evolving models, no fixed substitutes. Baseline original-run hash gap retained; bytes prospectively frozen and checked before/after every run.',
          decision='Diagnostic only. Four complete runs, no replacements, no overhead subtraction, no acceptance baseline change.'))
    runs = []
    for index, (mode, command) in enumerate(zip(order, commands), 1):
        dest = output / f'run-{index}-{mode}'
        assert all(digest(BASELINE / name) == sha for name, sha in baseline_hashes.items())
        observation = 'on' if args.ownership_reversal else mode
        runsource = reversal if mode == 'reversal' else source
        runenv = dict(env, TASK102_PHASE_OUTPUT=str(dest), TASK102_PHASE_MODE=observation)
        with (dest / 'command.log').open('w', buffering=1) as log:
            log.write('COMMAND: ' + json.dumps(command) + '\nMODE: ' + mode + '\n')
            start = time.monotonic()
            result = subprocess.run(command, cwd=runsource, env=runenv, stdout=log, stderr=subprocess.STDOUT)
            seconds = time.monotonic() - start
            log.write(f'EXIT_CODE: {result.returncode}\nELAPSED_WALL_SECONDS: {seconds:.9f}\n')
        assert all(digest(BASELINE / name) == sha for name, sha in baseline_hashes.items())
        record = dict(index=index, mode=mode, seconds=seconds, exit_code=result.returncode,
                      log_sha256=digest(dest / 'command.log'))
        runs.append(record)
        write(output / 'runs.json', runs)
        print(json.dumps(record), flush=True)
        if result.returncode:
            raise RuntimeError('Invalid capture retained; stop for concrete diagnostic defect review')
    assert all(digest(source / name) == sha for name, sha in hashes.items())
    if reversal_hashes:
        assert all(digest(reversal / name) == sha for name, sha in reversal_hashes.items())
    write(output / 'frozen-check.json', dict(sources='PASS', baseline='PASS', runs=len(runs)))


if __name__ == '__main__':
    main()
