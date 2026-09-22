#!/usr/bin/env python3
"""Offline TASK-183 interval budgets; never launches gameplay or changes inputs.

Usage: python3 ops/analyze_opening_critical_path.py ARTIFACT_ROOT OUTPUT_DIRECTORY
All references use zero-based JSON/JSONL record indices. Bounds are wall time.
"""
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import sys


def union(spans):
    merged = []
    for a, b in sorted(spans):
        if b <= a:
            continue
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def duration(spans):
    return sum(b - a for a, b in union(spans))


def sweep_duration(spans):
    events = {}
    for a, b in spans:
        if b <= a:
            continue
        events[a] = events.get(a, 0) + 1
        events[b] = events.get(b, 0) - 1
    active = 0
    total = 0
    previous = None
    for at, delta in sorted(events.items()):
        if active:
            total += at - previous
        active += delta
        previous = at
    assert active == 0
    return total


def clip(spans, a, b):
    return [(max(x, a), min(y, b)) for x, y in spans if min(y, b) > max(x, a)]


def epoch(value):
    return round(datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def analyze(root, relative, identities):
    base = root / relative
    def read(name):
        p = base / name
        if not p.exists():
            return None
        raw = p.read_bytes()
        identities[str(p)] = hashlib.sha256(raw).hexdigest()
        content = gzip.decompress(raw) if name.endswith('.gz') else raw
        return ([json.loads(line) for line in content.splitlines()] if name.endswith('.jsonl')
                else json.loads(content))
    def ref(name, index, field):
        return {'path': str(base / name), 'record': index, 'field': field}
    def point(name, index, field, at):
        return {'at': at, 'relativeToGameStartedMs': at - origin, 'source': ref(name, index, field)}
    wire = read('opening-event-ledger.json.gz')
    joins = read('join-timelines.json')
    inputs = read('input-traces.jsonl')
    latency = read('browser-latency.jsonl')
    boundaries = read('boundary-timings.json')
    observations = read('join-observations.json')
    result = read('result.json')
    checkpoints = read('checkpoints.json')
    read('source-identities.json')
    gs_i, gs = next((i, r) for i, r in enumerate(wire) if r.get('player') == 'p1' and r.get('event') == 'gameStarted')
    origin = gs['at']
    timer = gs['args'][0]['json']['timers'][1]['time']
    submit_i, submit = next((i, r) for i, r in enumerate(wire) if r.get('player') == 'p1' and r.get('event') == 'nextTurn' and r.get('direction') == 'sent')
    clicked = any(r['player'] == 'p1' and r.get('label') == 'end turn' and epoch(r['at']) <= submit['at'] for r in inputs)
    last_ready = max(r['waitResultAt'] for r in joins)
    first_ui_i, first_ui = next((i, r) for i, r in enumerate(inputs) if epoch(r['at']) > last_ready)
    first_ui_at = epoch(first_ui['at'])
    # A prerequisite deadline deficit: final readiness must precede the first move.
    # For unclicked H12 submissions only, use their observed timestamp as a
    # generous deadline ceiling, conditional on the established expiry mechanism.
    deficit = max(0, last_ready - submit['at']) if not clicked else None
    ledger = []
    def span(operation, start, end, qualification='measured enclosing wall span'):
        assert end['at'] >= start['at'], (operation, start, end)
        ledger.append({'operation': operation, 'start': start, 'end': end, 'qualification': qualification})
    for i, j in enumerate(joins):
        def jp(field):
            return point('join-timelines.json', i, field, j[field])
        span('join dispatch through readiness', jp('tapDispatchAt'), jp('waitResultAt'))
        span('join tapControl', jp('tapDispatchAt'), jp('tapCompletedAt'))
        span('sampler installation envelope', jp('tapCompletedAt'), jp('waitStartAt'), 'may include host scheduling; zero when disabled')
        span('readiness wait', jp('waitStartAt'), jp('waitResultAt'))
        menu_i, menu = next((k, r) for k, r in enumerate(inputs) if r['player'] == j['player'] and r.get('label') == 'online menu')
        end_i, end_menu = next((k, r) for k, r in enumerate(inputs) if r['player'] == j['player'] and r.get('label') == 'start menu')
        def menu_boundary(input_row, field):
            at = epoch(input_row['at'])
            matches = [(k, r) for k, r in enumerate(latency) if r['player'] == j['player'] and r['operation'] == 'tapControl' and r['startAt'] <= at <= r['endAt']]
            assert len(matches) == 1, (j['player'], at, matches)
            k, r = matches[0]
            return point('browser-latency.jsonl', k, field, r[field])
        span('menu preparation envelope', menu_boundary(menu, 'startAt'), menu_boundary(end_menu, 'endAt'), 'from first online-menu tapControl entry through start-menu tapControl return; includes required UI, not presumed avoidable')
        send = next(((k, r) for k, r in enumerate(wire) if r.get('player') == j['player'] and r.get('event') == 'startGameOrConnect'), None)
        board = next(((k, r) for k, r in enumerate(wire) if r.get('player') == j['player'] and r.get('event') in ('gameStarted', 'playYourTurn', 'waitYouTurn')), None)
        if send and board:
            span('socket send to first board receipt', point('opening-event-ledger.json.gz', send[0], 'at', send[1]['at']), point('opening-event-ledger.json.gz', board[0], 'at', board[1]['at']), 'transport observation; server admission and receiveBoard execution endpoints absent')
    for i, row in enumerate(latency):
        span('driver ' + row['operation'], point('browser-latency.jsonl', i, 'startAt', row['startAt']), point('browser-latency.jsonl', i, 'endAt', row['endAt']))
    if isinstance(observations, list):
        for i, o in enumerate(observations):
            # Export starts after every join; capture timestamps are concurrent,
            # not individual durations. Use one enclosing upper-bound interval.
            if 'capturedAt' in o:
                li = max(range(len(joins)), key=lambda k: joins[k]['waitResultAt'])
                span('collectJoinObservations envelope', point('join-timelines.json', li, 'waitResultAt', last_ready), point('join-observations.json', i, 'capturedAt', o['capturedAt']), 'concurrent export; entry/return timestamps absent; envelope only')
    if boundaries:
        for i, b in enumerate(boundaries):
            assert b['overflow'] == 0
            entries = {}
            for k, row in enumerate(b['rows']):
                if row['kind'] == 'enter':
                    entries[row['id']] = (k, row)
                else:
                    sk, start = entries.pop(row['id'])
                    span(row['name'], point('boundary-timings.json', i, f'rows[{sk}].at + timeOrigin', b['timeOrigin'] + start['at']), point('boundary-timings.json', i, f'rows[{k}].at + timeOrigin', b['timeOrigin'] + row['at']), 'browser performance.timeOrigin + performance.now; cross-clock uncertainty unbounded by retained calibration')
            assert not entries
    names = sorted({r['operation'] for r in ledger})
    budgets = []
    all_spans = []
    for name in names:
        indices = [i for i, r in enumerate(ledger) if r['operation'] == name]
        spans = [(ledger[i]['start']['at'], ledger[i]['end']['at']) for i in indices]
        live = clip(spans, origin, last_ready)
        early = clip(spans, origin, min(submit['at'], last_ready))
        saving = duration(live)
        independent = sweep_duration(live)
        assert abs(saving - independent) < .01
        all_spans.extend(live)
        budgets.append({'operation': name, 'ledgerIndices': indices, 'unionInsideReadinessPathMs': saving,
                        'independentSweepMs': independent, 'unionBeforeFirstSubmissionMs': duration(early),
                        'optimisticRemovableUpperBoundMs': saving,
                        'remainingReadinessDeficitLowerBoundMs': max(0, deficit - saving) if deficit is not None else None,
                        'couldCoverReadinessDeficit': ('no' if saving < deficit else 'not ruled out; not established') if deficit is not None else 'not applicable: clicked H6 control',
                        'meaning': 'remove entire observed envelope optimistically, including required work; not predicted speedup or CPU time'})
    # Post-join work cannot alter a prerequisite already late at final readiness.
    budgets.append({'operation': 'post-join collection, roster waits, slot reads and initial assertions',
                    'optimisticRemovableUpperBoundMs': 0, 'couldCoverReadinessDeficit': 'no' if deficit else 'not applicable',
                    'remainingReadinessDeficitLowerBoundMs': deficit,
                    'reason': 'source executes these only after last readiness; zero intersection with prerequisite path',
                    'laterEnvelopeUpperBoundMs': first_ui_at - last_ready})
    total = duration(all_spans)
    assert abs(total - sweep_duration(all_spans)) < .01
    return {'arm': relative, 'case': result['case'], 'result': result,
            'normalization': {'gameStarted': point('opening-event-ledger.json.gz', gs_i, 'at', origin),
                'actualTimerOrigin': None, 'initialTimerBudgetMs': timer,
                'timerBudgetSource': ref('opening-event-ledger.json.gz', gs_i, 'args[0].json.timers[1].time'),
                'nominalDeadlineAt': origin + timer,
                'actualDeadlineAt': None,
                'firstSubmission': point('opening-event-ledger.json.gz', submit_i, 'at', submit['at']),
                'firstSubmissionClicked': clicked, 'lastReadinessAt': last_ready,
                'firstPostJoinUI': point('input-traces.jsonl', first_ui_i, 'at', first_ui_at),
                'firstPostJoinUILabel': first_ui['label'],
                'firstP1Move': next((point('input-traces.jsonl', i, 'at', epoch(r['at'])) for i, r in enumerate(inputs) if r['player'] == 'p1' and r.get('label', '').startswith('legal single-step')), None),
                'readinessDeficitLowerBoundMs': deficit,
                'nominalReadinessDeficitMs': max(0, last_ready - origin - timer),
                'firstUIAfterSubmissionMs': first_ui_at - submit['at']},
            'ledger': ledger, 'budgets': budgets,
            'reconciliation': {'readinessPathMs': last_ready - origin, 'allIntervalsUnionMs': total,
                'independentSweepMs': sweep_duration(all_spans), 'uncoveredMs': last_ready - origin - total,
                'note': 'operation budgets overlap and must not be added'},
            'missing': ['Timer.updateLastPause initial assignment (actual origin and deadline absent)',
                        'server admission execution and receiveBoard entry/exit (wire receipt is not execution)',
                        'individual roster waits and source expression identity for generic observe rows',
                        'initial assertion timestamps (checkpoints preserve values but no times)'] + ([] if boundaries else ['generation and map/manager execution boundaries']),
            'initialAssertions': {'source': str(base / 'checkpoints.json'), 'count': len(checkpoints['checkpoints']),
                                  'enclosure': [last_ready, first_ui_at], 'exactEndpoints': None}}


def main():
    root, output = map(Path, sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    for name in ('critical-path-budget.json', 'critical-path-budget.md'):
        if (output / name).exists():
            raise SystemExit(f'refusing to overwrite {output / name}')
    # Fixed expected answers cover nested, concurrent, touching and clipped spans.
    for spans, expected in [([], 0), ([(0, 10), (2, 4), (8, 15)], 15), ([(0, 2), (2, 4), (8, 9)], 5), (clip([(0, 8), (4, 12)], 3, 10), 7)]:
        assert duration(spans) == sweep_duration(spans) == expected
    print('PASS union oracle: empty, nested, concurrent, touching and clipped spans')
    identities = {}
    arms = [analyze(root, family + '/run/' + arm, identities) for family, variants in [
        ('boundary-timing-20260922T173000Z', ['timing-off', 'timing-on']),
        ('h12-preparation-20260922', ['interleaved-baseline', 'prepared-candidate']),
        ('preparation-control-20260922', ['interleaved-baseline', 'prepared-repair'])] for arm in variants]
    conclusion = ('Missing boundary: the first Timer.updateLastPause assignment in p1 gameStarted handling, '
                  'recording lastPause and time in the browser clock. Retained gameStarted wire timestamps do not '
                  'give that assignment. The six arms cannot provide exact actual-deadline deficits. '
                  'A future separately predeclared H12 boundary-only control should record that one assignment '
                  'and its host/browser clock bracket in both arms, preserving original input, clocks, UI actions '
                  'and assertions; retain both arms. Do not repeat calibration. No production repair selected.')
    data = {'schema': 1, 'experiment': 'saved-evidence critical-path counterfactual budget',
            'clockLimits': 'Wire and driver use host Date.now; browser marks use timeOrigin + performance.now. No measured skew bound. Nominal cross-clock unions are not precise causal attribution. Unclicked submission gives a generous deadline ceiling only conditional on established Timer.check expiry; same-arm stack provenance is absent. Never substitute nominal gameStarted+budget for actual deadline.',
            'calibration': 'completed but unqualified; not repeated', 'arms': arms,
            'inputSHA256': identities, 'conclusion': conclusion, 'finalGate': 'UNSATISFIED'}
    (output / 'critical-path-budget.json').write_text(json.dumps(data, indent=2) + '\n')
    lines = ['# TASK-183 saved-evidence critical-path budget', '', data['clockLimits'], '',
             'All indices in JSON are zero-based. Each interval endpoint cites its original path, record and field. H6 seed2/fog-on is a contrasting input, never an H12 control. No new gameplay, instrument or optimization ran.', '',
             'The budget endpoint is final join readiness, a necessary prerequisite of initial assertions and the first move. This yields a lower bound on the repair needed; first post-join UI may merely dismiss an overlay. Missing H12 first moves remain missing. Savings assume complete removal of an operation envelope and ignore required work; they are optimistic bounds, not predicted speedups.', '',
             '| Arm | gameStarted → readiness ms | submission clicked | readiness deficit lower bound ms | first post-join UI after submission ms |',
             '| --- | ---: | --- | ---: | ---: |']
    for a in arms:
        n = a['normalization']
        lines.append(f"| {a['arm']} | {a['reconciliation']['readinessPathMs']} | {n['firstSubmissionClicked']} | {n['readinessDeficitLowerBoundMs']} | {n['firstUIAfterSubmissionMs']} |")
    for a in arms:
        lines += ['', '## ' + a['arm'], '', '| Operation | upper bound ms | remaining deficit ≥ ms | can cover? |', '| --- | ---: | ---: | --- |']
        for b in a['budgets']:
            lines.append(f"| {b['operation']} | {b['optimisticRemovableUpperBoundMs']:.3f} | {b['remainingReadinessDeficitLowerBoundMs']} | {b['couldCoverReadinessDeficit']} |")
        lines += ['', 'Union reconciliation: ' + json.dumps(a['reconciliation']), '', 'Missing: ' + '; '.join(a['missing']) + '.']
        print(f"PASS ARM {a['arm']} ledger={len(a['ledger'])} union_reconciled=true readiness_deficit_lower_bound_ms={a['normalization']['readinessDeficitLowerBoundMs']}")
    lines += ['', 'Source interpretation: opening-tiny-case.js prepare/join/collectJoinObservations then roster waits, slot reads, initial assertions and UI actions; options/onlineLogic.js gameStarted → receiveBoard → unfreezeGame → timer.updateLastPause; options/timer.js Timer.check compares Date.now-lastPause with time. Generic observe rows cannot identify their source expression. Menu envelopes are bounded by first and last menu tapControl calls; their required UI work is not presumed avoidable. Map start is nested in manager start and is never added to it. Socket receipt is not admission CPU time.', '',
              'Result: post-join-only work has zero intersection with the readiness prerequisite and cannot by itself cure the established H12 early expiry. Other broad envelopes may exceed the lower-bound deficit; that does not identify sufficient avoidable work. Exact-origin uncertainty and unlabeled observations prevent selecting a source operation repair.', '', conclusion, '',
              'CALIBRATION=COMPLETED_UNQUALIFIED', 'OFFLINE_BUDGET=COMPLETE_WITH_NAMED_GAP', 'FINAL_GATE=UNSATISFIED; TASK-183 remains pending. Original H12 playable/move/three-round and 132-case obligations remain required.']
    (output / 'critical-path-budget.md').write_text('\n'.join(lines) + '\n')
    print('OFFLINE_BUDGET=COMPLETE_WITH_NAMED_GAP')
    print('FINAL_GATE=UNSATISFIED')


if __name__ == '__main__':
    main()
