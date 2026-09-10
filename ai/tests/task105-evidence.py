#!/usr/bin/env python3
"""Freeze current TASK-105 sources and capture checks plus a single-change ablation.

The reference reconstructs pre-TASK-105 full-cell refresh and redundant comparison
on current code, preserving later vector channels, rules, undo fixes and training.
It is explicitly not a checkout of the historical parent (which has other changes).
Run with Node 20 on PATH and a NEW --artifacts directory. No favorable-run retries.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import time
from importlib.machinery import SourceFileLoader

REPO = Path(__file__).resolve().parents[2]
helper = SourceFileLoader('task103_evidence', str(Path(__file__).with_name('task103-evidence.py'))).load_module()
sha, save, execute = helper.sha, helper.save, helper.execute


def replace_once(path, old, new):
    text = path.read_text()
    assert text.count(old) == 1, (str(path), old)
    path.write_text(text.replace(old, new))


def reference(source):
    path = source / 'ai/mutableVectorGrid.js'
    text = path.read_text()
    start = text.index('function applyChangedCellFastAction(')
    end = text.index('var unitFastActionHandler', start)
    text = text[:start] + '''function applyChangedCellFastAction(mutableGrid, command) {
    let coords = collectAllMutableVectorGridCoords(mutableGrid)
    let previous = []
    let expansionLookup = typeof createSuburbExpansionLookup == 'undefined' ?
        undefined : createSuburbExpansionLookup()
    for (let coord of coords) {
        previous.push({coord: {x: coord.x, y: coord.y},
            vector: mutableGrid.cells[coord.x][coord.y].slice()})
        mutableGrid.cells[coord.x][coord.y] = typeof vectorizeCellLocal == 'undefined' ?
            vectorizeCell(grid.getCell(coord)) : vectorizeCellLocal(
                grid.getCell(coord), computeGlobalVectorChannels(), expansionLookup)
    }
    return {previous: previous, changedCellCount: coords.length}
}

function undoChangedCellFastAction(mutableGrid, token) {
    for (let entry of token.previous) {
        mutableGrid.cells[entry.coord.x][entry.coord.y] = entry.vector.slice()
    }
}

''' + text[end:]
    path.write_text(text)
    path = source / 'ai/players.js'
    replace_once(path,
        'let baselineVectorGrid = this.candidateScoringGrid ? null : vectoriseGrid()',
        'let baselineVectorGrid = this.candidateScoringGrid ?\n'
        '            [cloneVectorGridCells(this.candidateScoringGrid.cells),\n'
        '                this.candidateScoringGrid.suddenDeathMetric] : vectoriseGrid()')
    replace_once(path, 'applied = applyFastAction(mutableGrid, commands[i])',
        '''applied = applyFastAction(mutableGrid, commands[i])
                if (compareVectorGridResults(baselineVectorGrid, mutableGrid).equal) {
                    continue
                }''')
    # Restore per-cell scalar calculation while retaining the later suburb lookup.
    path = source / 'ai/vectorizeContent.js'
    text = path.read_text()
    start = text.index('function vectoriseGrid()')
    tail = text[start:]
    assert tail.count('let globalChannels = computeGlobalVectorChannels()') == 1
    tail = tail.replace('let globalChannels = computeGlobalVectorChannels()', '')
    assert tail.count('globalChannels, expansionLookup)') == 1
    tail = tail.replace('globalChannels, expansionLookup)', 'computeGlobalVectorChannels(), expansionLookup)')
    path.write_text(text[:start] + tail)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', required=True, type=Path)
    args = parser.parse_args()
    dest = args.artifacts.resolve()
    dest.mkdir(parents=True, exist_ok=False)
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).decode().split('\0')
    files += ['ai/tests/task105-evidence.py']
    files = sorted(set(f for f in files if f and not f.startswith('artifacts/')))
    save(dest / 'environment.json', dict(commit=helper.git('rev-parse', 'HEAD').decode().strip(),
        status=helper.git('status', '--short').decode(), platform=platform.platform(),
        cpu=Path('/proc/cpuinfo').read_text(), node=subprocess.check_output(['node', '-v'], text=True).strip(),
        environment={k:v for k,v in os.environ.items() if k in ('PATH','NODE_PATH','NODE_OPTIONS') or k.startswith(('TF_','OMP_'))},
        stressSeedStart=105000, canonicalSeed=87087,
        comparison='Current frozen source versus reconstructed immediate pre-optimization algorithm; only TASK-105 scoring/vector refresh is reversed.'))
    (dest / 'implementation.diff').write_bytes(helper.git('diff'))
    (dest / 'original-task105.diff').write_bytes(helper.git('show', 'c4c263d', '--', 'ai', 'options', 'sprites'))
    for variant in ('after', 'before'):
        source = dest / (variant + '-source')
        source.mkdir()
        for name in files:
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / name, target)
        (source / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    reference(dest / 'before-source')
    for variant in ('before', 'after'):
        save(dest / (variant + '-source-sha256.json'), {f:sha(dest/(variant+'-source')/f) for f in files})
    with (dest / 'reference.diff').open('wb') as out:
        subprocess.run(['diff', '-ru', '--exclude=node_modules', str(dest/'before-source'), str(dest/'after-source')], stdout=out)
    runs = []
    def run(label, command, variant='after', env=None, timeout=3600):
        record = execute(dest, label, command, dest/(variant+'-source'), timeout, env)
        record['variant'] = variant
        runs.append(record)
        save(dest/'runs.json', runs)
        return record
    suites = ['fast-unit-actions', 'fast-generated-map-invariants', 'fast-ownership-side-effects',
              'fast-unit-production-actions', 'fast-suburb-expansion-actions',
              'fast-building-placement-actions', 'mutable-vector-grid']
    for suite in suites:
        command = ['npm','run','test-'+suite]
        if suite == 'fast-generated-map-invariants':
            command += ['--','--report-path',str(dest/'step1-generated-report.json')]
        run('step1-'+suite, command)
    run('step2-stress', ['node','ai/test-fast-generated-map-invariants.js','--stress-ms','600000',
        '--seed-start','105000','--report-path',str(dest/'step2-stress-report.json')], timeout=1800)
    for suite in ('test-ai-fast-candidate-scoring','test-ai-economy','init-model','train','test-no-cheating-guard'):
        run('step4-'+suite, ['npm','run',suite])
    # The reference's full-cell implementation is checked by focused suites which
    # do not assert optimization-specific counts.
    for suite in ('test-fast-unit-actions','test-fast-ownership-side-effects','test-fast-unit-production-actions',
                  'test-fast-suburb-expansion-actions','test-fast-building-placement-actions','test-mutable-vector-grid','test-ai-fast-candidate-scoring'):
        run('reference-'+suite, ['npm','run',suite], 'before')
    for workload in ('fixed-candidate','canonical'):
        records = []
        for repeat in range(1,4):
            for variant in (('before','after') if repeat % 2 else ('after','before')):
                label = f'step5-{workload}-{variant}-{repeat}'
                env = dict(os.environ)
                if workload == 'fixed-candidate':
                    command = ['node','ai/benchmark-fast-candidate-scoring.js','200','120','40','40','1']
                else:
                    command = ['./train.sh','--storage-dir',str(dest/label),'--run-id','task105-canonical',
                        '--games','15','--epochs','1','--seed','87087','--old-vs-new-games','2',
                        '--plateau-window','2','--plateau-min-delta','2','--curriculum-lr-reduction-attempted']
                    env['NODE_OPTIONS'] = env.get('NODE_OPTIONS','') + ' --require=' + str(dest/'after-source/ai/tests/task103-observe.cjs')
                    env['TASK103_OUTCOMES'] = str(dest/(label+'-outcomes.jsonl'))
                records.append(run(label, command, variant, env, timeout=7200))
        medians = {v:statistics.median(r['seconds'] for r in records if r['variant']==v) for v in ('before','after')}
        reduction = 100*(1-medians['after']/medians['before'])
        save(dest/f'step5-{workload}-summary.json', dict(T_before=medians['before'], T_after=medians['after'],
             percentReduction=reduction, passed=all(r['exit_code']==0 for r in records) and reduction>=10, runs=records))
        for variant in ('before','after'):
            (dest/f'step5-{workload}-{variant}.log').write_text(''.join(Path(r['log']).read_text() for r in records if r['variant']==variant))
    hashes = {str(p.relative_to(dest)):sha(p) for p in dest.rglob('*')
              if p.is_file() and 'node_modules' not in p.parts and not any(s in p.parts for s in ('before-source','after-source'))}
    save(dest/'evidence-sha256.json',hashes)
    assert all(r['exit_code']==0 for r in runs), 'Failed commands; inspect runs.json'
    assert all(json.loads((dest/f'step5-{w}-summary.json').read_text())['passed'] for w in ('fixed-candidate','canonical')), 'Speed gate failed'
    print('TASK105 EVIDENCE RUN: PASS',flush=True)


if __name__ == '__main__':
    main()
