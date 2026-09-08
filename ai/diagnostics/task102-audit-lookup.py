#!/usr/bin/env python3
"""Audit complete lookup replays, exact traces, source bindings and calibration."""
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys

OUT = Path(sys.argv[1]).resolve()
read = lambda p: json.loads(p.read_text())
pre = read(OUT / 'predeclared.json')
for name, expected in pre['hashes'].items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name
print(f'FROZEN_INPUTS: PASS {len(pre["hashes"])} source/checkpoint/archive files')
runs = {}
original = None
original_bytes = None
traces = None
for mode in pre['modes']:
    for index, variant in enumerate(pre['order'], 1):
        label = f'{mode}-{index}-{variant}'
        log = (OUT / (label + '.log')).read_text()
        assert f'LOOKUP_REPLAY: PASS 22 complete scenarios; {variant} {mode}' in log
        assert '\nEXIT_CODE: 0\n' in log
        run = read(OUT / (label + '.json'))
        assert (run['variant'], run['mode']) == (variant, mode)
        encoded = (OUT / (label + '.results.json.gz')).read_bytes()
        results = json.loads(gzip.decompress(encoded))
        assert len(results) == len(pre['scenarios']) == len(run['records'])
        if original is None:
            original = results
            original_bytes = encoded
        assert encoded == original_bytes, (label, 'byte-identical complete result archive')
        assert results == original, label
        for item, record, result in zip(pre['scenarios'], run['records'], results):
            assert record['id'] == item['id']
            assert record['resultHash'] == runs.get('off-1-control', run)['records'][pre['scenarios'].index(item)]['resultHash']
            if item['group'] != 'component':
                assert result['games'] == [item['expected']], (label, item['id'], 'archived full outcome')
        if mode == 'trace':
            current = [read(OUT / (label + '.' + item['id'] + '.trace.json')) for item in pre['scenarios']]
            assert all(current), 'nonempty traces for every scenario'
            for item, record in zip(pre['scenarios'], run['records']):
                raw = (OUT / (label + '.' + item['id'] + '.trace.json')).read_bytes().removesuffix(b'\n')
                assert hashlib.sha256(raw).hexdigest() == record['traceHash'], 'trace content hash'
                assert len(read(OUT / (label + '.' + item['id'] + '.trace.json'))) == record['traceCount']
            if traces is None:
                traces = current
            assert current == traces, label
        runs[label] = run
        print(f'REPLAY_EQUIVALENCE: PASS {label} 22 full results, examples and archived canonical outcomes')
lifetime_refs = sum(sum(value is not None for value in record['meta']) for game in traces
                    for record in game if record['kind'] == 'inputs')
assert lifetime_refs > 0
print(f'SNAPSHOT_LIFETIME: PASS {lifetime_refs} active reference checks per trace pass; four successful passes')
print('RESULT_BYTES: PASS all twelve complete compressed result/example archives identical')
print('TRACE_EQUIVALENCE: PASS all input/score/command/order/snapshot records in four passes')
print('TEACHER_EXAMPLES: PASS ' + str(sum(len(r['result']['examples']) for r in original if 'examples' in r['result'])) + ' identical examples per pass')
summary = []
for group, pair in dict.fromkeys((item['group'], item['pair']) for item in pre['scenarios']):
    times = {}
    calibration = {}
    counts = {}
    for variant in ['control', 'scan']:
        for mode in pre['modes']:
            selected = [run for run in runs.values() if run['mode'] == mode and run['variant'] == variant]
            values = [sum(r['ms'] for r in run['records'] if (r['group'], r['pair']) == (group, pair)) for run in selected]
            calibration[f'{variant}-{mode}'] = values
            if mode == 'off':
                times[variant] = values
            if mode == 'counts':
                per_pass = []
                for run in selected:
                    total = {}
                    for r in run['records']:
                        if (r['group'], r['pair']) == (group, pair):
                            for key, value in r['counts'].items():
                                total[key] = total.get(key, 0) + value
                    per_pass.append(total)
                assert per_pass[0] == per_pass[1]
                counts[variant] = per_pass[0]
    for site in ['builds', 'sets', 'buildStrings', 'queryStrings']:
        assert counts['control'][site] > 0 and counts['scan'].get(site, 0) == 0, (group, pair, site)
    assert counts['control']['cells'] == counts['scan']['cells']
    assert counts['control']['eligibleCells'] == counts['scan']['eligibleCells']
    before = statistics.mean(times['control'])
    after = statistics.mean(times['scan'])
    result = dict(group=group, pair=pair, timesMs=times, beforeMeanMs=before, afterMeanMs=after,
                  reductionPercent=(before-after)/before*100, counts=counts,
                  calibrationTimesMs=calibration,
                  calibrationRatios={f'{v}-{m}': statistics.mean(calibration[f'{v}-{m}']) / statistics.mean(times[v])
                                     for v in times for m in ['counts', 'trace']})
    summary.append(result)
    print('LOOKUP_EFFECT: ' + json.dumps(result))
# Raw GC entries overlap wall time. Clip and union them per game; never add to wall time.
for label, run in runs.items():
    gc_ms = 0
    for record in run['records']:
        spans = sorted((max(record['begin'], e['start']), min(record['end'], e['start'] + e['duration'])) for e in run['gc']
                       if e['start'] < record['end'] and e['start'] + e['duration'] > record['begin'])
        end = record['begin']
        for begin, stop in spans:
            gc_ms += max(0, stop - max(begin, end))
            end = max(end, stop)
    memory = [r[key] for r in run['records'] for key in ['memoryBefore', 'memoryAfter']]
    print(f'MEMORY_GC: {label} overlapping_gc_ms={gc_ms:.6f} observed_peak_heap={max(m["heapUsed"] for m in memory)} observed_peak_rss={max(m["rss"] for m in memory)}')
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print('LOOKUP_REMOVAL: PASS zero scan builds/Sets/lookup strings; identical cells and eligibility in all classes')
print('GC_ACCOUNTING: PASS clipped interval union; observed memory is not allocation volume')
print('BOUNDED_AUDIT: PASS 264 complete results, 22 unique scenarios; no full speed acceptance')

phase_pre = read(OUT / 'phase-predeclared.json')
assert hashlib.sha256(Path(phase_pre['file']).read_bytes()).hexdigest() == phase_pre['hash']
phase_reference = {}
for variant in phase_pre['order']:
    label = 'phases-' + variant
    run = read(OUT / (label + '.json'))
    assert (run['variant'], run['mode']) == (variant, 'counts')
    assert len(run['records']) == len(pre['scenarios'])
    results = json.loads(gzip.decompress((OUT / (label + '.results.json.gz')).read_bytes()))
    assert results == original
    log = (OUT / (label + '.log')).read_text()
    assert 'LOOKUP_REPLAY: PASS 22 complete scenarios' in log and '\nEXIT_CODE: 0\n' in log
    off_mean_ms = statistics.mean(sum(r['ms'] for r in v['records']) for v in runs.values()
                                 if v['variant'] == variant and v['mode'] == 'off')
    print('PHASE_CALIBRATION: ' + variant + ' overhead_ratio=' + str(sum(r['ms'] for r in run['records']) / off_mean_ms))
    for record in run['records']:
        c = record['counts']
        assert sum(c.get('phaseCells:' + phase, 0) for phase in ['full', 'changed', 'other']) == c['cells']
        assert sum(c.get('phaseEligible:' + phase, 0) for phase in ['full', 'changed', 'other']) == c['eligibleCells']
        assert c['phaseEligible:changed'] > 0
        phase_counts = {k: v for k, v in c.items() if k.startswith('phase')}
        if variant == 'control':
            phase_reference[record['id']] = phase_counts
        assert phase_reference[record['id']] == phase_counts
        print('CHANGED_CELL_COUNTS: ' + variant + ' ' + record['id'] + ' ' + str(c['phaseEligible:changed']))
print('PHASE_AUDIT: PASS 44 supplemental outcomes; full/changed eligibility counts reconciled')
