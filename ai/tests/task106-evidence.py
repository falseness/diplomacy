#!/usr/bin/env python3
"""Record all AI regressions and actual parent-serial/current-worker timings.

Run with Node 20 and a fresh --artifacts directory. Freeze before either mode;
no benchmark result changes the predeclared seeds, commands, or repeat count.
"""
import argparse
from importlib.machinery import SourceFileLoader
import io
import json
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[2]
helper = SourceFileLoader('task103_evidence', str(Path(__file__).with_name('task103-evidence.py'))).load_module()
sha, save, execute = helper.sha, helper.save, helper.execute


def freeze(dest):
    parent = helper.git('rev-parse', 'HEAD').decode().strip()
    before = dest / 'before-source'
    before.mkdir()
    with tarfile.open(fileobj=io.BytesIO(helper.git('archive', parent))) as archive:
        archive.extractall(before)
    after = dest / 'after-source'
    after.mkdir()
    names = helper.git('ls-files', '-z').decode().split('\0')
    names += ['ai/tests/task106-evidence.py']
    for name in set(names):
        if name and not name.startswith('artifacts/'):
            target = after / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / name, target)
    manifests = {}
    for label, root in [('before', before), ('after', after)]:
        manifests[label] = {str(p.relative_to(root)): sha(p)
                           for p in sorted(root.rglob('*')) if p.is_file()}
        (root / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    save(dest / 'source-sha256.json', manifests)
    (dest / 'implementation.diff').write_bytes(helper.git('diff', 'HEAD'))
    baseline = Path('/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training')
    save(dest / 'environment.json', dict(parent=parent, status=helper.git('status', '--short').decode(),
         platform=platform.platform(), cpu=Path('/proc/cpuinfo').read_text(),
         affinity=sorted(os.sched_getaffinity(0)),
         node=subprocess.check_output(['node', '--version'], text=True).strip(),
         environment={k: v for k, v in os.environ.items() if k in ('PATH', 'NODE_PATH', 'NODE_OPTIONS')
                      or k.startswith(('TF_', 'OMP_', 'DIPLOMACY_'))},
         baseline={str(p): sha(p) for p in baseline.iterdir() if p.is_file()},
         plan=dict(seed=87087, games=15, epochs=1, repeats=3,
                   beforeWorkers=1, afterWorkers=2, deterministicTrainingControl='DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT=1', order=['before-after', 'after-before', 'before-after'])))


def assert_frozen(dest):
    manifests = json.loads((dest / 'source-sha256.json').read_text())
    for name, digest in manifests['after'].items():
        assert sha(REPO / name) == digest, 'source changed since freeze: ' + name
    for variant, manifest in manifests.items():
        for name, digest in manifest.items():
            assert sha(dest / (variant + '-source') / name) == digest


def speed(dest):
    observer = dest / 'observe-games.cjs'
    source = Path(__file__).with_name('task103-observe.cjs').read_text()
    # Worker isolates have separate counters. Qualify only the observer's event ID.
    source = source.replace('const id = ++sequence;',
                            'const id = require("worker_threads").threadId + ":" + (++sequence);')
    observer.write_text(source)
    ledger = dest / 'speed-runs.json'
    runs = json.loads(ledger.read_text()) if ledger.exists() else []
    completed = {run['label'] for run in runs}
    assert len(completed) == len(runs), 'duplicate recorded run'
    for run in runs:
        assert sha(Path(run['log'])) == run['sha256'], 'changed timing log: ' + run['label']
    with (dest / 'step5-canonical-speed.log').open('a' if runs else 'w', buffering=1) as combined:
        for repeat in range(1, 4):
            order = ['before', 'after'] if repeat % 2 else ['after', 'before']
            for variant in order:
                label = f'controlled-canonical-{variant}-{repeat}'
                if label in completed:
                    continue
                command = ['./train.sh', '--storage-dir', str(dest / label),
                           '--run-id', 'task106-canonical', '--games', '15', '--epochs', '1',
                           '--seed', '87087', '--old-vs-new-games', '2', '--plateau-window', '2',
                           '--plateau-min-delta', '2', '--curriculum-lr-reduction-attempted',
                           '--workers', '1' if variant == 'before' else '2']
                env = dict(os.environ)
                env['NODE_OPTIONS'] = env.get('NODE_OPTIONS', '') + ' --require=' + str(observer)
                env['TASK103_OUTCOMES'] = str(dest / (label + '-outcomes.jsonl'))
                control = {'DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT': '1'}
                env.update(control)
                run = execute(dest, label, command, dest / (variant + '-source'),
                              3600, env, {'trainingControl': control})
                run.update(variant=variant, repeat=repeat)
                runs.append(run)
                combined.write(Path(run['log']).read_text())
                save(dest / 'speed-runs.json', runs)
    medians = {v: statistics.median(r['seconds'] for r in runs if r['variant'] == v)
               for v in ('before', 'after')}
    reduction = 100 * (1 - medians['after'] / medians['before'])
    save(dest / 'step5-canonical-speed-summary.json', dict(
         T_before=medians['before'], T_after=medians['after'], percentReduction=reduction,
         passed=all(r['exit_code'] == 0 for r in runs) and reduction >= 10, runs=runs,
         comparison='Unmodified immediately preceding HEAD with workers=1 versus frozen current implementation with workers=2; same deterministic initialization/order, epochs, seeds, games, evaluation and final serialization.',
         projectedScaling='At most N-way teacher generation for the 20-game pretraining batch (capped at 20); cadence batches have two games (capped at 2), overlapped with serial training. End-to-end scaling remains bounded by serial TensorFlow fitting/evaluation and IPC overhead.'))
    return all(r['exit_code'] == 0 for r in runs) and reduction >= 10


def regression(dest, manifest_path):
    manifest = json.loads(manifest_path.read_text())
    scripts = json.loads((REPO / 'package.json').read_text())['scripts']
    names = ['init-model', 'train'] + [n for n in scripts if n.startswith('test-')]
    assert set(names) == set(manifest['commands'])
    ledger = dest / 'regression-runs.json'
    runs = json.loads(ledger.read_text()) if ledger.exists() else []
    assert [run['label'] for run in runs] == names[:len(runs)], 'non-prefix regression ledger'
    for run in runs:
        assert sha(Path(run['log'])) == run['sha256'], 'changed regression log: ' + run['label']
    with (dest / 'step4-regression.log').open('a' if runs else 'w', buffering=1) as combined:
        for name in names[len(runs):]:
            entry, env = helper.regression_entry(name, manifest)
            reports = dest / (name + '-reports')
            reports.mkdir()
            env[helper.REPORT_KEY] = str(reports)
            evidence_env = {key: str(reports) for key in
                            ('AI_CADENCE_EVIDENCE_DIR', 'TASK065_EVIDENCE_DIR')}
            env.update(evidence_env)
            entry['evidenceEnvironment'] = evidence_env
            if name == 'test-task106-self-play-workers':
                env['TASK106_SMOKE_STORAGE'] = str(reports / 'training')
                entry['evidenceEnvironment']['TASK106_SMOKE_STORAGE'] = env['TASK106_SMOKE_STORAGE']
                entry['timeout_seconds'] = 1200
            if name == 'test-economy-training':
                env['ECONOMY_TRAINING_EVIDENCE_DIR'] = str(reports / 'training')
                entry['evidenceEnvironment']['ECONOMY_TRAINING_EVIDENCE_DIR'] = env['ECONOMY_TRAINING_EVIDENCE_DIR']
            run = execute(dest, name, ['npm', 'run', name], REPO,
                          entry['timeout_seconds'], env, entry)
            # This suite records its checkpoint storage outside the report directory.
            # Copy it before hashing so failed curriculum gates retain their proof too.
            if name == 'test-combat-full-training-verification':
                for evidence in reports.glob('full-training-*.json'):
                    storage = Path(json.loads(evidence.read_text())['storageDir'])
                    shutil.copytree(storage, reports / 'training', dirs_exist_ok=True)
            run['reports'] = helper.capture_reports(dest, name, reports)
            runs.append(run)
            combined.write(Path(run['log']).read_text())
            save(dest / 'regression-runs.json', runs)
            helper.regression_entry(name, manifest)
        combined.write(f'ALL_AI_SUITES: {"PASS" if all(r["exit_code"] == 0 for r in runs) else "FAIL"}; attempted={len(runs)} failed={sum(r["exit_code"] != 0 for r in runs)}\n')
    # The npm registry does not include every existing standalone AI suite.
    # Discover these before dispatch and retain their failures in the same gate.
    registered = '\n'.join(scripts.values())
    standalone = [str(p.relative_to(REPO)) for p in sorted((REPO / 'ai').glob('test-*.js'))
                  if str(p.relative_to(REPO)) not in registered]
    save(dest / 'standalone-plan.json', standalone)
    standalone_ledger = dest / 'standalone-runs.json'
    extra_runs = json.loads(standalone_ledger.read_text()) if standalone_ledger.exists() else []
    assert [r['command'] for r in extra_runs] == [['node', name] for name in standalone[:len(extra_runs)]]
    for run in extra_runs:
        assert sha(Path(run['log'])) == run['sha256'], 'changed standalone log: ' + run['label']
    with (dest / 'standalone-regression.log').open('a' if extra_runs else 'w', buffering=1) as combined:
        for filename in standalone[len(extra_runs):]:
            run = execute(dest, 'standalone-' + Path(filename).stem,
                          ['node', filename], REPO, helper.REGRESSION_TIMEOUT, dict(os.environ))
            extra_runs.append(run)
            combined.write(Path(run['log']).read_text())
            save(standalone_ledger, extra_runs)
        combined.write(f'STANDALONE_AI_SUITES: {"PASS" if all(r["exit_code"] == 0 for r in extra_runs) else "FAIL"}; attempted={len(extra_runs)} failed={sum(r["exit_code"] != 0 for r in extra_runs)}\n')
    all_runs = runs + extra_runs
    with (dest / 'step4-regression.log').open('a') as combined:
        combined.write((dest / 'standalone-regression.log').read_text())
        combined.write(f'ALL_AI_TEST_COVERAGE: registered={len(runs)} standalone={len(extra_runs)} total={len(all_runs)} passed={sum(r["exit_code"] == 0 for r in all_runs)} failed={sum(r["exit_code"] != 0 for r in all_runs)}; {"PASS" if all(r["exit_code"] == 0 for r in all_runs) else "FAIL"}\n')
    return all(r['exit_code'] == 0 for r in all_runs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--mode', choices=['freeze', 'regression', 'speed'], required=True)
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    dest = args.artifacts.resolve()
    if args.mode == 'freeze':
        dest.mkdir(parents=True, exist_ok=False)
        freeze(dest)
        return
    assert_frozen(dest)
    if args.mode == 'speed':
        passed = speed(dest)
    else:
        assert args.manifest, 'regression requires frozen checkpoint manifest'
        passed = regression(dest, args.manifest)
    assert_frozen(dest)
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
