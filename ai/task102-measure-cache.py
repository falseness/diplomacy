#!/usr/bin/env python3
"""Measure fresh direct VM globals against the preceding TASK-102 cache.

Archive the actual preceding and implemented revisions without source substitution.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shlex
import statistics
import subprocess
import tarfile
import time

BEFORE = '8d2e35ea4a44418de778dc210f86b4d5f68cff6b'
AFTER = '6b71478984339ac390fc32f3dfc97123c57e7496'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_sources(repo, dest, env):
    def git(*arguments):
        return subprocess.check_output(['git', *arguments], cwd=repo)
    manifest = {}
    for variant in ('before', 'after'):
        source = dest / (variant + '-source')
        source.mkdir()  # Refuse to overwrite evidence from an earlier attempt.
        revision = BEFORE if variant == 'before' else AFTER
        with tarfile.open(fileobj=io.BytesIO(git('archive', revision))) as archive:
            archive.extractall(source)
        files = [p for p in source.rglob('*') if p.is_file()]
        manifest[variant] = {str(p.relative_to(source)): digest(p) for p in files}
        (source / 'node_modules').symlink_to(repo / 'node_modules', target_is_directory=True)
    changed = sorted(k for k in set(manifest['before']) | set(manifest['after'])
                     if manifest['before'].get(k) != manifest['after'].get(k))
    # Keep the complete actual trees, including documentation and test changes.
    (dest / 'revision.diff').write_bytes(git('diff', BEFORE, AFTER))
    (dest / 'source-sha256.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (dest / 'provenance.json').write_text(json.dumps({
        'host_sha': git('rev-parse', 'HEAD').decode().strip(),
        'host_status': git('status', '--short').decode(), 'before_revision': BEFORE,
        'after_revision': AFTER, 'changed_sources': changed,
        'node': subprocess.check_output(['node', '--version'], env=env, text=True).strip(),
        'platform': platform.platform(), 'cpu': Path('/proc/cpuinfo').read_text().split('model name')[1].splitlines()[0],
        'environment': {k: v for k, v in env.items() if k == 'PATH' or k.startswith(('TF_', 'OMP_', 'DIPLOMACY_', 'CUDA', 'NODE_'))},
        'determinism_seeds': list(range(10400, 10420)),
        'component_seeds': list(range(10200, 10250)), 'training_seed': 87087,
        'interpretation': 'Performance/equivalence only, no trained strength or winrate claim. Same fixed workloads in both variants.'
    }, indent=2) + '\n')
    (dest / 'host.diff').write_bytes(git('diff', '--', 'ai'))
    return manifest


def write_drivers(dest):
    # Observe exported runGame calls; never modify options, classes or results.
    observer = dest / 'observe-games.cjs'
    observer.write_text("""const fs = require('fs');
const Module = require('module');
const original = Module._load;
const wrapped = new WeakSet();
Module._load = function(...args) {
  const result = original.apply(this, args);
  if (args[0].endsWith('benchmarkHarness') && result.runGame && !wrapped.has(result)) {
    wrapped.add(result);
    const run = result.runGame;
    result.runGame = function(options) {
      const scenario = {...options};
      delete scenario.predictFunction;
      fs.appendFileSync(process.env.TASK102_OUTCOMES, JSON.stringify({event:'start', scenario})+'\\n');
      try {
        const game = run.apply(this, arguments);
        fs.appendFileSync(process.env.TASK102_OUTCOMES, JSON.stringify({event:'result', game})+'\\n');
        return game;
      } catch (error) {
        fs.appendFileSync(process.env.TASK102_OUTCOMES, JSON.stringify({event:'crash', error:String(error.stack)})+'\\n');
        throw error;
      }
    };
  }
  return result;
};
""")
    driver = dest / 'run-games.cjs'
    driver.write_text("""const {runGame} = require(process.cwd() + '/ai/benchmarkHarness');
async function main() {
const {loadCheckpoint, createPredictor} = require(process.cwd() + '/ai/benchmark-gamestart-trained-model');
const checkpoint = await loadCheckpoint(process.env.TASK102_CHECKPOINT);
console.log('CHECKPOINT: '+JSON.stringify(checkpoint.report));
const predictFunction = createPredictor(checkpoint.model, {calls:0, positions:0, resizedInputs:0, channelAdaptations:0});
const count = Number(process.argv[2]);
const seed = Number(process.argv[3]);
const rounds = Number(process.argv[4]);
for (let i = 0; i < count; i++) {
  const game = runGame({mapName:'tiny-duel', playerA:'AIPlayer', playerB:'SimpleAiPlayer',
    seed:seed+i, roundLimit:rounds, actionLimit:3, commandLimit:60,
    predictFunction, modelIdentifier:checkpoint.model, inferenceSource:'TASK-102 frozen checkpoint'});
  console.log('GAME_RESULT: '+JSON.stringify({seed:seed+i, winnerSide:game.winnerSide,
    winner:game.winner, roundCount:game.roundCount,
    inferenceCalls:game.inference.calls, inferencePositions:game.inference.positions}));
}
console.log('GAMES_COMPLETE: '+count);
checkpoint.model.dispose();
}
main().catch(error => { console.error(error.stack); process.exitCode=1; });
""")
    return observer, driver


def execute(dest, env, runs, observer, label, variant, command, observe=False):
    source = dest / (variant + '-source')
    logpath = dest / (label + '.log')
    runenv = env.copy()
    if observe:
        runenv['NODE_OPTIONS'] = (runenv.get('NODE_OPTIONS', '') + ' --require=' + str(observer)).strip()
        runenv['TASK102_OUTCOMES'] = str(dest / (label + '-outcomes.jsonl'))
    with logpath.open('w', buffering=1) as log:
        log.write('COMMAND: ' + shlex.join(command) + '\nCWD: ' + str(source) + '\n')
        log.write('SOURCE_REVISION: ' + (BEFORE if variant == 'before' else AFTER) + '\nVARIANT: ' + variant + '\n')
        log.write('START_UTC: ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        start = time.monotonic()
        proc = subprocess.run(command, cwd=source, env=runenv, stdout=log, stderr=subprocess.STDOUT)
        elapsed = time.monotonic() - start
        log.write(f'EXIT_CODE: {proc.returncode}\nELAPSED_WALL_SECONDS: {elapsed:.6f}\n')
    record = dict(label=label, variant=variant, command=command, seconds=elapsed,
                  exit_code=proc.returncode, log=str(logpath), log_sha256=digest(logpath))
    runs.append(record)
    (dest / 'runs.json').write_text(json.dumps(runs, indent=2) + '\n')
    print(json.dumps(record), flush=True)
    return proc.returncode


def compare_determinism(dest, env, runs, observer, driver):
    for variant in ('before', 'after'):
        execute(dest, env, runs, observer, 'pre-change-determinism-' + variant, variant, ['node', str(driver), '20', '10400', '30'])
    before = [s for s in (dest / 'pre-change-determinism-before.log').read_text().splitlines() if s.startswith('GAME_RESULT:')]
    after = [s for s in (dest / 'pre-change-determinism-after.log').read_text().splitlines() if s.startswith('GAME_RESULT:')]
    with (dest / 'pre-change-determinism.log').open('w') as log:
        matched = (before == after and len(before) == 20 and
                   all(run['exit_code'] == 0 for run in runs))
        log.write('PRE_CHANGE_DETERMINISM: ' + ('PASS' if matched else 'FAIL') + ' 20 seeds\n')
        log.write('\n'.join(before) + '\n')
    return matched


def measure_kind(kind, dest, env, runs, observer, driver):
    for index in range(1, 4):
        order = ('before', 'after') if index % 2 else ('after', 'before')
        for variant in order:
            label = f'{kind}-{variant}-{index}'
            if kind == 'component':
                command = ['node', str(driver), '50', '10200', '1']
            else:
                command = ['./train.sh', '--storage-dir', str(dest / label),
                           '--run-id', 'task102-canonical', '--games', '15', '--epochs', '1',
                           '--seed', '87087', '--old-vs-new-games', '2', '--plateau-window', '2',
                           '--plateau-min-delta', '2', '--curriculum-lr-reduction-attempted']
            execute(dest, env, runs, observer, label, variant, command, observe=(kind == 'canonical-training'))
    selected = [r for r in runs if r['label'].startswith(kind + '-')]
    medians = {v: statistics.median(r['seconds'] for r in selected if r['variant'] == v)
               for v in ('before', 'after')}
    reduction = 100 * (1 - medians['after'] / medians['before'])
    passed = all(r['exit_code'] == 0 for r in selected) and reduction >= 10
    with (dest / (kind + '-speed.log')).open('w') as log:
        for record in selected:
            log.write(json.dumps(record) + '\n')
        log.write(f'T_BEFORE_MEDIAN_SECONDS: {medians["before"]:.6f}\nT_AFTER_MEDIAN_SECONDS: {medians["after"]:.6f}\nREDUCTION_PERCENT: {reduction:.6f}\n')
        log.write('SPEED_GATE: ' + ('PASS' if passed else 'FAIL') + ' required >=10 percent\n')
    print(f'{kind}: reduction={reduction:.2f}% passed={passed}', flush=True)
    return passed


def audit_sources(dest, manifest):
    for variant, hashes in manifest.items():
        assert all(digest(dest / (variant + '-source') / name) == sha for name, sha in hashes.items())
    (dest / 'frozen-source-check.log').write_text('FROZEN_SOURCE_HASHES: PASS\n')
    checkpoints = {str(p.relative_to(dest)): digest(p) for p in dest.glob('canonical-training-*/**/*')
                   if p.is_file() and p.name in ('model.json', 'weights.bin')}
    (dest / 'checkpoint-sha256.json').write_text(json.dumps(checkpoints, indent=2) + '\n')


def main():
    global BEFORE, AFTER
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', default=BEFORE, help='Actual baseline git revision or tree')
    parser.add_argument('--after', default=AFTER, help='Actual frozen candidate git revision or tree')
    parser.add_argument('--node-bin', required=True, type=Path)
    parser.add_argument('--checkpoint', type=Path, default=Path('/mnt/storage/diplomacy/task036-incremental-long/final/task036-long'))
    parser.add_argument('--artifacts', type=Path, default=Path('artifacts/TASK-102'))
    args = parser.parse_args()
    BEFORE, AFTER = args.before, args.after
    repo = Path(__file__).resolve().parent.parent
    dest = args.artifacts.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PATH=str(args.node_bin.resolve()) + os.pathsep + os.environ['PATH'])
    env.pop('DIPLOMACY_DISABLE_BROWSER_SCRIPT_CACHE', None)
    env['TASK102_CHECKPOINT'] = str(args.checkpoint.resolve())
    manifest = prepare_sources(repo, dest, env)
    (dest / 'measurement-wrapper.py').write_bytes(Path(__file__).read_bytes())
    observer, driver = write_drivers(dest)
    runs = []
    passed = [compare_determinism(dest, env, runs, observer, driver)]
    # Sequential paired measurements, with alternating order to reduce drift.
    for kind in ('component', 'canonical-training'):
        passed.append(measure_kind(kind, dest, env, runs, observer, driver))
    audit_sources(dest, manifest)
    raise SystemExit(0 if all(passed) else 1)


if __name__ == '__main__':
    main()
