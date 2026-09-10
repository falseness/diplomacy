#!/usr/bin/env python3
"""Capture current invariants and TASK-105's actual parent/child speed comparison.

Run with Node 20 on PATH and a NEW --artifacts directory. Historical runtime
sources are extracted verbatim from Git; only the identical measurement fixture
(missing in the parent) is added. No reconstructed baseline or favorable retries.
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
BEFORE = 'e31dfccdedca361bf8d3672bc642fe10c77cb872'
AFTER = 'c4c263d58c16c2b2b4ca695305c32697a3066d85'
FIXTURE = 'ai/benchmark-fast-candidate-scoring.js'
SUITES = ['fast-unit-actions', 'fast-generated-map-invariants', 'fast-ownership-side-effects',
          'fast-unit-production-actions', 'fast-suburb-expansion-actions',
          'fast-building-placement-actions', 'mutable-vector-grid']


def source_manifest(source):
    return {str(p.relative_to(source)): sha(p) for p in sorted(source.rglob('*'))
            if p.is_file() and 'node_modules' not in p.parts}


def freeze_history(dest, variant, commit):
    source = dest / (variant + '-source')
    source.mkdir()
    archive = helper.git('archive', commit)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source)
    # This fixture loads the selected checkout's actual scorer and mutable grid.
    # Its vectorizer/predictor are synthetic; canonical training uses real ones.
    fixture = helper.git('show', AFTER + ':' + FIXTURE)
    (source / FIXTURE).write_bytes(fixture)
    manifest = source_manifest(source)
    save(dest / (variant + '-source-sha256.json'), manifest)
    (source / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    return dict(commit=commit, source=str(source), files=len(manifest),
                manifest=str(dest / (variant + '-source-sha256.json')),
                fixtureSha256=sha(source / FIXTURE),
                onlyOverlay=FIXTURE if variant == 'before' else None)


def freeze(dest):
    assert helper.git('rev-parse', AFTER + '^').decode().strip() == BEFORE
    bindings = {v: freeze_history(dest, v, c) for v, c in [('before', BEFORE), ('after', AFTER)]}
    current = dest / 'current-source'
    current.mkdir()
    files = helper.git('ls-files', '-z').decode().split('\0')
    for name in files:
        if not name or name.startswith('artifacts/'):
            continue
        target = current / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / name, target)
    save(dest / 'current-source-sha256.json', source_manifest(current))
    (current / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    (dest / 'implementation.diff').write_bytes(helper.git('diff'))
    (dest / 'historical-task105.diff').write_bytes(helper.git('diff', BEFORE, AFTER))
    save(dest / 'baseline-provenance.json', dict(
        marker='BASELINE PROVENANCE: PASS', comparison='actual immediately preceding parent and isolated TASK-105 child',
        before=bindings['before'], after=bindings['after'], parentVerified=True,
        currentCommit=helper.git('rev-parse', 'HEAD').decode().strip(),
        historicalDiff=str(dest / 'historical-task105.diff'),
        limitation='Historical speed comparison; current runtime correctness checked separately. Microbenchmark has synthetic vectorizer/predictor.',
        sourceRule='Every Git-tracked historical byte is unchanged; only the identical child benchmark fixture is added to parent.'))
    save(dest / 'environment.json', dict(platform=platform.platform(), cpu=Path('/proc/cpuinfo').read_text(),
        node=subprocess.check_output(['node', '-v'], text=True).strip(),
        status=helper.git('status', '--short', '-uno').decode(),
        environment={k: v for k, v in os.environ.items() if k in ('PATH', 'NODE_PATH', 'NODE_OPTIONS') or k.startswith(('TF_', 'OMP_'))},
        stressSeedStart=105000, canonicalSeed=87087, repeats=3,
        order=['before-1', 'after-1', 'after-2', 'before-2', 'before-3', 'after-3']))


def checks(dest, run):
    for suite in SUITES:
        command = ['npm', 'run', 'test-' + suite]
        if suite == 'fast-generated-map-invariants':
            command += ['--', '--report-path', str(dest / 'step1-generated-report.json')]
        run('step1-' + suite, command)
    run('step2-stress', ['node', 'ai/test-fast-generated-map-invariants.js', '--stress-ms', '600000',
        '--seed-start', '105000', '--report-path', str(dest / 'step2-stress-report.json')], timeout=1800)
    for suite in ('test-ai-fast-candidate-scoring', 'test-ai-economy', 'init-model', 'train', 'test-no-cheating-guard'):
        run('step4-' + suite, ['npm', 'run', suite])


def benchmark(dest, run, workload):
    records = []
    for repeat in range(1, 4):
        for variant in (('before', 'after') if repeat % 2 else ('after', 'before')):
            label = f'step5-{workload}-{variant}-{repeat}'
            env = dict(os.environ)
            if workload == 'fixed-candidate':
                command = ['node', FIXTURE, '200', '120', '40', '40', '1']
            else:
                command = ['./train.sh', '--storage-dir', str(dest / label), '--run-id', 'task105-canonical',
                    '--games', '15', '--epochs', '1', '--seed', '87087', '--old-vs-new-games', '2',
                    '--plateau-window', '2', '--plateau-min-delta', '2', '--curriculum-lr-reduction-attempted']
                env['NODE_OPTIONS'] = env.get('NODE_OPTIONS', '') + ' --require=' + str(dest / 'current-source/ai/tests/task103-observe.cjs')
                env['TASK103_OUTCOMES'] = str(dest / (label + '-outcomes.jsonl'))
            records.append(run(label, command, variant, env, timeout=7200))
    medians = {v: statistics.median(r['seconds'] for r in records if r['variant'] == v) for v in ('before', 'after')}
    reduction = 100 * (1 - medians['after'] / medians['before'])
    save(dest / f'step5-{workload}-summary.json', dict(T_before=medians['before'], T_after=medians['after'],
         beforeCommit=BEFORE, afterCommit=AFTER, percentReduction=reduction,
         passed=all(r['exit_code'] == 0 for r in records) and reduction >= 10, runs=records))
    for variant in ('before', 'after'):
        (dest / f'step5-{workload}-{variant}.log').write_text(''.join(Path(r['log']).read_text() for r in records if r['variant'] == variant))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', required=True, type=Path)
    args = parser.parse_args()
    dest = args.artifacts.resolve()
    dest.mkdir(parents=True, exist_ok=False)
    freeze(dest)
    runs = []

    def run(label, command, variant='current', env=None, timeout=3600):
        record = execute(dest, label, command, dest / (variant + '-source'), timeout, env)
        record['variant'] = variant
        runs.append(record)
        save(dest / 'runs.json', runs)
        return record

    checks(dest, run)
    for workload in ('fixed-candidate', 'canonical'):
        benchmark(dest, run, workload)
    save(dest / 'evidence-sha256.json', {str(p.relative_to(dest)): sha(p) for p in dest.rglob('*')
         if p.is_file() and 'node_modules' not in p.parts and not any(s in p.parts for s in ('before-source', 'after-source', 'current-source'))})
    assert all(r['exit_code'] == 0 for r in runs), 'Failed commands; inspect runs.json'
    assert all(json.loads((dest / f'step5-{w}-summary.json').read_text())['passed'] for w in ('fixed-candidate', 'canonical')), 'Speed gate failed'
    print('TASK105 EVIDENCE RUN: PASS', flush=True)


if __name__ == '__main__':
    main()
