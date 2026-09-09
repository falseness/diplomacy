#!/usr/bin/env python3
"""Audit complete finite phase captures, with no timing/semantic cherry-picking."""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import statistics
import sys

ORDER = ('off', 'on', 'on', 'off')
FACTORIAL_ORDER = ('A', 'B', 'D', 'C', 'C', 'D', 'B', 'A')
OWNERSHIP_ORDER = ('control', 'reversal', 'reversal', 'control')
UNDO_PATH = 'ai/mutableVectorGrid.js'
UNDO_CAPTURE = 'vector: mutableGrid.cells[coord.x][coord.y]'
EXPECTED_GAMES = 130
EXPECTED_TEACHERS = 50
EXPECTED_STEPS = 15
HASH_CHUNK_BYTES = 1024 * 1024
EARLY_LAST_STEP = 7
BASELINE_PHASE = 'evaluation-baseline'


def ownership_comparison(summary):
    """Compare both adjacent pairs, preserving early/late signs and GC overlap."""
    pairs = []
    for control, reversal in ((summary[0], summary[1]), (summary[3], summary[2])):
        segments = {}
        for segment in ('all', 'early', 'late'):
            values = []
            for run in (control, reversal):
                events = [event for event in run['trajectory']
                          if event['phase'] == BASELINE_PHASE and
                          (segment == 'all' or
                           (segment == 'early' and 0 < event['step'] <= EARLY_LAST_STEP) or
                           (segment == 'late' and event['step'] > EARLY_LAST_STEP))]
                assert events, (run['index'], segment)
                values.append(dict(events=len(events),
                                   seconds=sum(e['exclusiveMs'] for e in events) / 1000,
                                   gcOverlapSeconds=sum(e['gcOverlapMs'] for e in events) / 1000,
                                   minHeapMiB=min(e['before']['heapUsed'] for e in events) / 2**20,
                                   maxHeapMiB=max(e['after']['heapUsed'] for e in events) / 2**20))
            assert values[0]['events'] == values[1]['events']
            segments[segment] = dict(control=values[0], reversal=values[1],
                reductionPercent=100 * (1 - values[1]['seconds'] / values[0]['seconds']))
        pairs.append(dict(controlRun=control['index'], reversalRun=reversal['index'],
                          wallReductionPercent=100 * (1 - reversal['seconds'] / control['seconds']),
                          baseline=segments))
    consistent = all(segment['reductionPercent'] > 0
                     for pair in pairs for segment in pair['baseline'].values())
    return dict(pairs=pairs, consistentBaselineImprovement=consistent,
                interpretation='Diagnostic mechanism comparison, not acceptance. GC overlaps wall time. '
                'All pair/segment signs retained; no host-causality or learned-strength claim.')


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(HASH_CHUNK_BYTES), b''):
            result.update(chunk)
    return result.hexdigest()


def read(path):
    return json.loads(path.read_text())


def lines(path):
    with path.open() as stream:
        return [json.loads(line) for line in stream]


def gc_overlap(gc, start, end):
    intervals = sorted((max(start, e['start']), min(end, e['end'])) for e in gc
                       if e['end'] > start and e['start'] < end)
    total, previous = 0, start
    for left, right in intervals:
        total += max(0, right - max(left, previous))
        previous = max(previous, right)
    return total


def audit(output):
    declared = read(output / 'predeclared.json')
    ownership = declared.get('experiment') == 'ownership-reversal'
    factorial = declared.get('experiment') == 'lookup-ownership'
    order = FACTORIAL_ORDER if factorial else (OWNERSHIP_ORDER if ownership else ORDER)
    assert declared['order'] == list(order)
    assert declared['node'] == 'v20.20.2'
    assert digest(output / 'observe.cjs') == declared['hook_sha256']
    assert digest(output / 'driver.py') == declared['driver_sha256']
    for name, sha in declared['sources'].items():
        assert digest(output / 'source' / name) == sha, name
    if ownership:
        assert declared['reversal_sources'].keys() == declared['sources'].keys()
        changed = [name for name in declared['sources']
                   if declared['sources'][name] != declared['reversal_sources'][name]]
        assert changed == [UNDO_PATH], changed
        original = (output / 'source' / UNDO_PATH).read_text()
        assert original.count(UNDO_CAPTURE) == 1
        assert (output / 'source-reversal' / UNDO_PATH).read_text() == original.replace(
            UNDO_CAPTURE, UNDO_CAPTURE + '.slice()'), 'unexpected reversal source'
        for name, sha in declared['reversal_sources'].items():
            assert digest(output / 'source-reversal' / name) == sha, name
        print('SINGLE_MECHANISM: PASS only undo capture .slice(); all arms use common observation on')
    if factorial:
        for arm, hashes in declared['arm_sources'].items():
            assert hashes.keys() == declared['sources'].keys()
            for name, sha in hashes.items():
                assert digest(output / ('source-' + arm) / name) == sha, (arm, name)
        assert set(declared['arm_sources']) == set('ABCD')
    for name, sha in declared['baseline_hashes'].items():
        assert digest(output / 'baseline-frozen' / name) == sha, name
        assert digest(Path(declared['baseline']) / name) == sha, name
    print(f'FROZEN_INPUTS: PASS {len(declared["sources"])} sources; prospective baseline bytes intact')
    runs = read(output / 'runs.json')
    assert len(runs) == len(order)
    assert read(output / 'frozen-check.json') == dict(sources='PASS', baseline='PASS', runs=len(order))
    summary, reference, manifests = [], None, {}
    for index, (mode, run) in enumerate(zip(order, runs), 1):
        dest = output / f'run-{index}-{mode}'
        assert run['index'] == index and run['mode'] == mode and run['exit_code'] == 0, f'invalid run {index}'
        assert digest(dest / 'command.log') == run['log_sha256']
        log = (dest / 'command.log').read_text()
        assert 'Completed game 15/15' in log and '\nEXIT_CODE: 0\n' in log
        elapsed = [line for line in log.splitlines() if line.startswith('ELAPSED_WALL_SECONDS: ')]
        assert len(elapsed) == 1 and abs(float(elapsed[0].split(': ')[1]) - run['seconds']) < 1e-8, 'raw elapsed drift'
        assert f'\nMODE: {mode}\n' in log
        assert json.loads(log.splitlines()[0].removeprefix('COMMAND: ')) == declared['commands'][index - 1]
        phases = read(dest / 'phases.json')
        observation = 'on' if ownership or factorial else mode
        assert phases['mode'] == observation and phases['code'] == 0 and not phases['unfinished']
        assert phases['counts']['teacherGames'] == EXPECTED_TEACHERS
        assert phases['counts']['step'] == EXPECTED_STEPS
        outcomes = lines(dest / 'outcomes.jsonl')
        assert len(outcomes) == EXPECTED_GAMES * 2
        assert [e['event'] for e in outcomes] == ['start', 'result'] * EXPECTED_GAMES
        # Complete objects, including labels, failures and non-results, are compared.
        teachers = lines(dest / 'teachers.jsonl')
        assert len(teachers) == EXPECTED_TEACHERS
        assert sum(len(t['examples']) for t in teachers) == phases['counts']['teacherExamples']
        teacher_hash = digest(dest / 'teachers.jsonl')
        losses = lines(dest / 'losses.jsonl')
        assert Counter(l['name'] for l in losses) == {'pretrain-fit': 1, 'ranking-fit': 16, 'synthetic-fit': 15}
        assert all(l['history']['loss'] for l in losses)
        checkpoint_hashes = {str(p.relative_to(dest / 'storage')): digest(p)
                             for p in (dest / 'storage').rglob('*')
                             if p.is_file() and p.name in ('weights.bin', 'model.json')}
        assert len(checkpoint_hashes) == 32  # 15 checkpoints plus final, two files each.
        metrics_path = dest / 'storage/metrics/task102-canonical.jsonl'
        progress_path = dest / 'storage/progress/task102-canonical.jsonl'
        # Path names in provenance are normalized; no outcome, policy or time field is dropped.
        def normalize(value):
            return json.dumps(value, sort_keys=True).replace(str(dest / 'storage'), '<STORAGE>')
        semantics = (normalize(outcomes), teacher_hash, losses, checkpoint_hashes,
                     normalize(lines(metrics_path)), normalize(lines(progress_path)),
                     digest(dest / 'observed-runner.js'))
        if reference is None:
            reference = semantics
        else:
            for label, actual, expected in zip(('outcomes', 'teachers', 'losses', 'checkpoints', 'metrics', 'progress', 'observed-source'), semantics, reference):
                assert actual == expected, f'run {index}: {label} drift'
        manifests[str(index)] = {str(p.relative_to(dest)): digest(p) for p in dest.rglob('*') if p.is_file()}
        scenario_counts = Counter(e['scenario']['inferenceSource'] for e in outcomes if e['event'] == 'start')
        winners = Counter(str(e['game']['winnerSide']) for e in outcomes if e['event'] == 'result')
        scenarios = [e['scenario'] for e in outcomes if e['event'] == 'start']
        print(f'COMPLETE_SEMANTICS: PASS run {index} {mode}; 130 outcomes, 50 teacher games, {phases["counts"]["teacherExamples"]} examples, 32 loss histories, 16 model snapshots')
        del teachers
        totals, trajectory = defaultdict(float), []
        if observation == 'on':
            events = phases['events']
            for event in events:
                assert event['end'] >= event['start'] >= 0
                assert event['exclusiveMs'] >= 0
                assert abs(event['exclusiveMs'] - (event['end'] - event['start'] - event['childrenMs'])) < 1e-6
                children = [e for e in events if e is not event and e['start'] >= event['start'] and e['end'] <= event['end']]
                direct = [e for e in children if not any(parent is not e and parent['start'] <= e['start'] and parent['end'] >= e['end'] for parent in children)]
                assert abs(sum(e['end'] - e['start'] for e in direct) - event['childrenMs']) < 1e-5
                totals[event['name']] += event['exclusiveMs']
                if event['name'] != 'startup':
                    trajectory.append(dict(phase=event['name'], step=event['step'], start=event['start'],
                                           exclusiveMs=event['exclusiveMs'], before=event['memoryBefore'], after=event['memoryAfter'],
                                           countsAfter=event['countsAfter'], gcOverlapMs=gc_overlap(phases['gc'], event['start'], event['end'])))
            totals['unattributed-residual'] = phases['totalMs'] - sum(totals.values())
            totals['process-bootstrap-shutdown'] = run['seconds'] * 1000 - phases['totalMs']
            assert totals['unattributed-residual'] >= 0 and totals['process-bootstrap-shutdown'] >= 0
            assert abs(sum(totals.values()) - run['seconds'] * 1000) < 1e-5
            required = {'startup', 'teacher-rollout', 'ranking-preparation-cleanup', 'ranking-fit', 'pretrain-fit',
                        'synthetic-fit', 'evaluation-old-new', 'evaluation-simple', 'evaluation-baseline',
                        'model-load', 'model-dispose', 'checkpoint-io'}
            assert required <= totals.keys(), required - totals.keys()
            print(f'PHASE_RECONCILIATION: PASS run {index}; exclusive phases + residual = {run["seconds"]:.6f}s; GC is overlapping only')
        summary.append(dict(index=index, mode=mode, seconds=run['seconds'], exclusiveMs=dict(totals),
                            gcUnionMs=gc_overlap(phases['gc'], 0, phases['totalMs']), trajectory=trajectory,
                            retention=lines(dest / 'retention.jsonl') if observation == 'on' else [],
                            counts=phases['counts'], scenarioCounts=dict(scenario_counts), winners=dict(winners), scenarios=scenarios))
    off = [r['seconds'] for r in runs if r['mode'] == ('A' if factorial else ('control' if ownership else 'off'))]
    on = [r['seconds'] for r in runs if r['mode'] == ('B' if factorial else ('reversal' if ownership else 'on'))]
    calibration = dict(offSeconds=off, onSeconds=on, onOverOffMean=statistics.mean(on) / statistics.mean(off),
                       interpretation=f'Two per mode, ordered {order}. No overhead subtraction or acceptance claim.')
    (output / 'summary.json').write_text(json.dumps(dict(runs=summary, calibration=calibration), indent=2) + '\n')
    (output / 'evidence-sha256.json').write_text(json.dumps(manifests, indent=2) + '\n')
    observed = summary if ownership or factorial else [r for r in summary if r['mode'] == 'on']
    report = ['# Full canonical phase accounting', '',
              'Diagnostic observation comparison only; not either speed acceptance gate.', '',
              '| Exclusive phase | ' + ' | '.join(f'Run {r["index"]} {r["mode"]} seconds' for r in observed) + ' | Combined wall share |',
              '|---|' + '---:|' * (len(observed) + 1)]
    wall_ms = sum(r['seconds'] * 1000 for r in observed)
    phase_names = sorted(set().union(*(r['exclusiveMs'].keys() for r in observed)))
    for name in phase_names:
        values = [r['exclusiveMs'].get(name, 0) for r in observed]
        report.append(f'| {name} | ' + ' | '.join(f'{value / 1000:.6f}' for value in values) + f' | {sum(values) / wall_ms:.3%} |')
    report += ['', f'All scheduled outer wall seconds, in order: {[r["seconds"] for r in summary]}.',
               f'{"Reversal/control" if ownership else "Observation on/off"} mean ratio: {calibration["onOverOffMean"]:.6f}; no overhead subtraction.',
               f'GC union seconds (overlapping, not additive): {[r["gcUnionMs"] / 1000 for r in observed]}.',
               '', '## Early/late phases', '',
               'Startup is step 0; early is steps 1–7; late is steps 8–15. Means divide by actual event count.', '',
               '| Run | Segment | Phase | Events | Total seconds | Mean seconds |', '|---|---|---|---:|---:|---:|']
    for run in observed:
        groups = defaultdict(list)
        for event in run['trajectory']:
            segment = 'startup' if event['step'] == 0 else ('early' if event['step'] <= 7 else 'late')
            groups[(segment, event['phase'])].append(event['exclusiveMs'] / 1000)
        for (segment, name), values in sorted(groups.items()):
            report.append(f'| {run["index"]} | {segment} | {name} | {len(values)} | {sum(values):.6f} | {statistics.mean(values):.6f} |')
    report += ['', '## Boundary retention trajectory', '',
               'Teacher totals are cumulative. Live example counts describe the current ranking input only. '
               'Metric counts describe naturally retained metric objects. Missing counts are unobserved, not zero.', '',
               '| Run | Step | Live batch results | Live batch examples | Retained metrics | Cumulative examples | Heap MiB | RSS MiB |',
               '|---|---:|---:|---:|---:|---:|---:|---:|']
    for run in observed:
        for boundary in run['retention']:
            report.append(f'| {run["index"]} | {boundary["step"]} | {boundary.get("retainedResults", "—")} | '
                          f'{boundary.get("retainedExamples", "—")} | {boundary.get("retainedMetricRecords", "—")} | '
                          f'{boundary["teacherExamples"]} | {boundary["memory"]["heapUsed"] / 2**20:.3f} | '
                          f'{boundary["memory"]["rss"] / 2**20:.3f} |')
    fitting_ms = sum(value for r in observed for name, value in r['exclusiveMs'].items() if name.endswith('-fit'))
    report += ['', f'Fitting wall share: {fitting_ms / wall_ms:.6%}. Even eliminating all non-fitting work '
               f'would save at most {1 - fitting_ms / wall_ms:.6%} of observed wall time (an upper bound, not a forecast).',
               '', 'PHASE_TABLE: PASS all exclusive intervals and residuals reconcile; complete retention boundaries retained.',
               'SEMANTICS: PASS all scheduled complete workloads match; no learned-strength or holdout claim.']
    (output / 'phase-table.md').write_text('\n'.join(report) + '\n')
    if ownership:
        comparison = ownership_comparison(summary)
        (output / 'ownership-comparison.json').write_text(json.dumps(comparison, indent=2) + '\n')
        print('OWNERSHIP_COMPARISON: ' + json.dumps(comparison))
    print('OBSERVATION_CALIBRATION: ' + json.dumps(calibration))
    print('FULL_PHASE_AUDIT: PASS diagnostic coverage and semantic equality; speed acceptance remains pending')


if __name__ == '__main__':
    audit(Path(sys.argv[1]).resolve())
