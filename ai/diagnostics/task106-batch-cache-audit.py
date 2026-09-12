#!/usr/bin/env python3
"""Offline prerequisite audit. Integrity and readiness have separate outcomes."""
import hashlib
import json
from pathlib import Path
import sys


def verify_hash(file, expected, directory):
    data = Path(file).read_bytes()
    if hashlib.sha256(data).hexdigest() == expected:
        return
    # The only post-measurement amendment removed one EOF blank line.
    # Bind it byte-for-byte to the archived executable; allow no code delta.
    script = Path('ai/diagnostics/task106-batch-cache-screen.cjs')
    assert Path(file).resolve() == script.resolve(), file
    original = (directory / 'diagnostics' / script.name).read_bytes()
    assert hashlib.sha256(original).hexdigest() == expected
    assert original == data + b'\n', 'only one EOF newline may differ'


def validate(plan, report):
    expected = [result for boundary in plan['boundaries'] for result in boundary['results']]
    assert len(expected) == 4
    assert report['passed'] and report['games'] == expected, 'full saved result parity'
    assert len(report['attempted']) == len(expected), 'attempt coverage'
    assert len(report['gameTimings']) == len(expected), 'timing coverage'
    assert len({boundary['hash'] for boundary in plan['boundaries']}) == 2
    assert report['finalTensors'] == report['finalCacheBytes'] == 0, 'cleanup'
    calls = report['calls']
    assert len(calls) == sum(result['inference']['calls'] for result in expected)
    assert sum(call['positions'] for call in calls) == sum(result['inference']['positions'] for result in expected)
    for boundary in plan['boundaries']:
        for expected_result in boundary['results']:
            selected = [call for call in calls if call['seed'] == expected_result['seed']]
            assert len(selected) == expected_result['inference']['calls']
            assert sum(call['positions'] for call in selected) == expected_result['inference']['positions']
            assert all(call['boundary'] == boundary['hash'] for call in selected)
    for result, timing in zip(expected, report['gameTimings']):
        for role, cache in zip(['current', 'baseline'], timing['cache']):
            selected = [call for call in calls if call['seed'] == result['seed'] and call['role'] == role]
            assert selected and selected[-1]['cache'] == cache, 'cache accounting coverage'
            assert cache['hits'] + cache['misses'] == sum((call['positions'] + 31) // 32 for call in selected)
    for call in calls:
        assert call['mismatch'] == -1 and call['stableTensors'], 'numeric/tensor parity'
        assert call['beforeMs'] >= 0 and call['afterMs'] >= 0
        assert 0 <= call['cache']['bytes'] <= call['cache']['peakBytes'] <= plan['cacheBytes']
    caches = [cache for timing in report['gameTimings'] for cache in timing['cache']]
    assert len(caches) == 8
    before = sum(call['beforeMs'] for call in calls)
    after = sum(call['afterMs'] for call in calls)
    wall = sum(timing['ms'] for timing in report['gameTimings'])
    estimated_original = wall - after
    assert estimated_original > 0
    reduction = 100 * (before - after) / estimated_original
    return dict(games=4, calls=len(calls), positions=sum(c['positions'] for c in calls),
                nonResults=sum(bool(result['nonResult']) for result in expected),
                beforePredictorMs=before, afterPredictorMs=after, instrumentedGameMs=wall,
                estimatedOriginalGameMs=estimated_original, estimatedEvaluationReductionPercent=reduction,
                predictorReductionPercent=100 * (before - after) / before,
                hits=sum(c['hits'] for c in caches), misses=sum(c['misses'] for c in caches),
                evictions=sum(c['evictions'] for c in caches), peakAccountedBytes=max(c['peakBytes'] for c in caches),
                opportunityPass=reduction >= plan['screenThreshold'],
                limitations='Paired instrumented estimate only; excludes cold loading/IPC/fits/serialization. '
                'Includes comparison overhead, shared-host effects and alternating call order. '
                'No complete-process speedup, canonical median or readiness claim.')


def main():
    directory = Path(sys.argv[1])
    plan = json.loads((directory / 'plan.json').read_text())
    hashes = json.loads((directory / 'frozen-hashes.json').read_text())
    for group in hashes.values():
        for file, expected in group.items():
            verify_hash(file, expected, directory)
    provenance = json.loads((directory / 'paired/provenance.json').read_text())
    assert provenance['node'] == 'v20.20.2' and provenance['tf']['tfjs'] == '4.22.0'
    assert 'Cpus_allowed_list:\t0-1' in provenance['processStatus']
    assert provenance['environment']['NODE_OPTIONS'] == '--max-old-space-size=6144'
    assert not any(k.startswith(('TF_', 'OMP_', 'MKL_')) for k in provenance['environment'])
    for group in ['sources', 'inputs']:
        for file, expected in provenance[group].items():
            verify_hash(file, expected, directory)
    assert 'EXIT_CODE: 0\n' in (directory / 'paired.log').read_text()
    summary = validate(plan, json.loads((directory / 'paired/report.json').read_text()))
    (directory / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print('CACHE INTEGRITY: PASS source/input hashes runtime configuration and complete result parity')
    print('CACHE COVERAGE: PASS games={games} calls={calls} positions={positions} nonResults={nonResults}'.format(**summary))
    print('CACHE CLEANUP: PASS modelTensors=0 cacheBytes=0 boundedPerCache=16777216')
    print(json.dumps(summary, sort_keys=True))
    print('CACHE OPPORTUNITY: ' + ('PASS' if summary['opportunityPass'] else 'FAIL') +
          ' estimatedEvaluationReductionPercent=' + str(summary['estimatedEvaluationReductionPercent']))
    print('READINESS: NOT ESTABLISHED no actual-production full-cost or canonical timing')
    return 0 if summary['opportunityPass'] else 1


if __name__ == '__main__':
    sys.exit(main())
