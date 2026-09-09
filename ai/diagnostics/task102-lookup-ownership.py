#!/usr/bin/env python3
"""Finite same-source lookup x undo factorial; never an acceptance benchmark."""
import argparse
import difflib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import time

ORDER = ('A', 'B', 'D', 'C', 'C', 'D', 'B', 'A')
REPO = Path(__file__).resolve().parents[2]
BASELINE = Path('/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training')
CHECKPOINT = Path('/mnt/storage/diplomacy/task036-incremental-long/final/task036-long')
PATCHES = {
    'ai/vectorizeContent.js': ('let expansionLookup = createSuburbExpansionLookup()', 'let expansionLookup = undefined'),
    'ai/mutableVectorGrid.js': ("let expansionLookup = typeof createSuburbExpansionLookup == 'undefined' ?\n        undefined : createSuburbExpansionLookup()", 'let expansionLookup = undefined'),
}
CAPTURE = 'vector: mutableGrid.cells[coord.x][coord.y].slice()'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


phase = load('phase_audit', REPO / 'ai/diagnostics/task102-audit-full-phases.py')
digest = phase.digest


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def transform(original, name, arm):
    text = original
    if name in PATCHES and arm in ('B', 'D'):
        before, after = PATCHES[name]
        assert text.count(before) == 1, (name, 'lookup source mismatch')
        text = text.replace(before, after)
    if name == 'ai/mutableVectorGrid.js' and arm in ('C', 'D'):
        assert text.count(CAPTURE) == 1, 'capture source mismatch'
        text = text.replace(CAPTURE, CAPTURE.removesuffix('.slice()'))
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--node-bin', required=True, type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    git = lambda *args: subprocess.check_output(['git', *args], cwd=REPO)
    revision = git('rev-parse', 'HEAD').decode().strip()
    source = out / 'source'
    source.mkdir()
    with tarfile.open(fileobj=io.BytesIO(git('archive', revision))) as archive:
        archive.extractall(source)
    hashes = {str(p.relative_to(source)): digest(p) for p in source.rglob('*') if p.is_file()}
    (source / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    arms = {}
    for arm in 'ABCD':
        dest = out / ('source-' + arm)
        shutil.copytree(source, dest, symlinks=True)
        diff = []
        for name in PATCHES:
            original = (source / name).read_text()
            changed = transform(original, name, arm)
            (dest / name).write_text(changed)
            diff.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True), fromfile='source/' + name, tofile=arm + '/' + name))
        arms[arm] = {name: digest(dest / name) for name in hashes}
        (out / (arm + '.diff')).write_text(''.join(diff))
    hook = out / 'observe.cjs'
    shutil.copyfile(REPO / 'ai/diagnostics/task102-full-phases.cjs', hook)
    shutil.copyfile(__file__, out / 'driver.py')
    measure = load('measure', REPO / 'ai/task102-measure-cache.py')
    _, driver = measure.write_drivers(out)
    # Same component options and predictor; additionally preserve complete returned objects.
    driver.write_text(driver.read_text().replace("  console.log('GAME_RESULT:", "  require('fs').appendFileSync(process.env.TASK102_COMPONENT_OUTCOMES, JSON.stringify({seed:seed+i, game})+'\\n');\n  console.log('GAME_RESULT:"))
    baseline_hashes = {str(p.relative_to(BASELINE)): digest(p) for p in BASELINE.rglob('*') if p.is_file()}
    checkpoint_hashes = {str(p.relative_to(CHECKPOINT)): digest(p) for p in CHECKPOINT.rglob('*') if p.is_file()}
    assert 'model.json' in baseline_hashes and 'model.json' in checkpoint_hashes
    shutil.copytree(BASELINE, out / 'baseline-frozen')
    shutil.copytree(CHECKPOINT, out / 'checkpoint-frozen')
    env = dict(os.environ, PATH=str(args.node_bin.resolve()) + os.pathsep + os.environ['PATH'],
               NODE_PATH='/usr/share/nodejs', NODE_OPTIONS=f'--max-old-space-size=6144 --require={hook}',
               TASK102_CHECKPOINT=str(CHECKPOINT))
    assert not any(k.startswith('DIPLOMACY_') for k in env)
    commands = []
    for index, arm in enumerate(ORDER, 1):
        dest = out / f'run-{index}-{arm}'
        dest.mkdir()
        commands.append(['./train.sh', '--storage-dir', str(dest / 'storage'), '--run-id', 'task102-canonical',
                         '--games', '15', '--epochs', '1', '--seed', '87087', '--old-vs-new-games', '2',
                         '--plateau-window', '2', '--plateau-min-delta', '2', '--curriculum-lr-reduction-attempted'])
    # Freeze installed dependency bytes, not only version strings; do not follow symlink cycles.
    dependencies = {str(p.relative_to(REPO / 'node_modules')): digest(p)
                    for p in (REPO / 'node_modules').rglob('*') if p.is_file()}
    write(out / 'dependency-sha256.json', dependencies)
    write(out / 'predeclared.json', dict(experiment='lookup-ownership', revision=revision,
          tree=git('rev-parse', 'HEAD^{tree}').decode().strip(), status=git('status', '--short').decode(),
          order=ORDER, commands=commands, sources=hashes, arm_sources=arms,
          hook_sha256=digest(hook), driver_sha256=digest(out / 'driver.py'),
          component_driver_sha256=digest(driver), component_command=['node', str(driver), '50', '10200', '1'],
          node_binary=str(args.node_bin.resolve() / 'node'), node_sha256=digest(args.node_bin.resolve() / 'node'),
          node=subprocess.check_output(['node', '--version'], env=env, text=True).strip(),
          dependency_manifest_sha256=digest(out / 'dependency-sha256.json'),
          dependencies=subprocess.check_output(['node', '-e', 'console.log(JSON.stringify(require("@tensorflow/tfjs-node").version))'], cwd=source, env=env, text=True).strip(),
          platform=platform.platform(), environment={k: v for k, v in env.items() if k == 'PATH' or k.startswith(('NODE_', 'TASK102_', 'TF_', 'OMP_', 'CUDA'))},
          baseline=str(BASELINE), baseline_hashes=baseline_hashes, checkpoint=str(CHECKPOINT), checkpoint_hashes=checkpoint_hashes,
          decision='Advance B only if both whole workloads improve versus A in both blocks, complete semantics match, and magnitude/path evidence plausibly supports both >=10% gates. Otherwise reject and close this hypothesis; no unchanged retry. Two per arm are diagnostic, not acceptance medians.',
          boundaries='Common coarse canonical phase observer, natural retention, separate identical 50-seed component processes. No forced GC, overhead subtraction, replacements, policy changes or cross-study timing mixtures.',
          provenance='External baseline original historical hash gap remains; all current input bytes frozen prospectively. Fixed equality/performance fixtures, no learned-strength or holdout claim.'))
    print('PREDECLARATION: PASS A/B/D/C then C/D/B/A; eight canonical and eight component processes', flush=True)
    runs, components = [], []
    def check_inputs():
        for root, entries in ((BASELINE, baseline_hashes), (CHECKPOINT, checkpoint_hashes)):
            assert all(digest(root / name) == sha for name, sha in entries.items())
    def execute(command, dest, arm, runenv, filename):
        with (dest / filename).open('x', buffering=1) as log:
            log.write('COMMAND: ' + json.dumps(command) + '\nMODE: ' + arm + '\n')
            log.write('START_UTC: ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
            start = time.monotonic()
            result = subprocess.run(command, cwd=out / ('source-' + arm), env=runenv, stdout=log, stderr=subprocess.STDOUT)
            seconds = time.monotonic() - start
            log.write(f'EXIT_CODE: {result.returncode}\nELAPSED_WALL_SECONDS: {seconds:.9f}\n')
        return dict(index=index, mode=arm, seconds=seconds, exit_code=result.returncode, log_sha256=digest(dest / filename))
    for index, (arm, command) in enumerate(zip(ORDER, commands), 1):
        dest = out / f'run-{index}-{arm}'
        check_inputs()
        component = execute(['node', str(driver), '50', '10200', '1'], dest, arm,
                            dict(env, TASK102_COMPONENT_OUTCOMES=str(dest / 'component-outcomes.jsonl')), 'component.log')
        components.append(component)
        write(out / 'component-runs.json', components)
        print('COMPONENT: ' + json.dumps(component), flush=True)
        assert component['exit_code'] == 0, 'Failed capture retained; stop for diagnostic review'
        run = execute(command, dest, arm, dict(env, TASK102_PHASE_OUTPUT=str(dest), TASK102_PHASE_MODE='on'), 'command.log')
        runs.append(run)
        write(out / 'runs.json', runs)
        print('CANONICAL: ' + json.dumps(run), flush=True)
        check_inputs()
        assert run['exit_code'] == 0, 'Failed capture retained; stop for diagnostic review'
    for arm, entries in arms.items():
        assert all(digest(out / ('source-' + arm) / name) == sha for name, sha in entries.items())
    assert all(digest(REPO / 'node_modules' / name) == sha for name, sha in dependencies.items())
    write(out / 'frozen-check.json', dict(sources='PASS', baseline='PASS', runs=len(runs)))
    print('FACTORIAL_CAPTURE: PASS eight complete canonical/component pairs; frozen inputs intact', flush=True)


if __name__ == '__main__':
    main()
