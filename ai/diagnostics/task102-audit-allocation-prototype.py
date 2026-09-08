#!/usr/bin/env python3
"""Validate the isolated allocation intervention and report all bounded timings."""
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys

attempt = Path(sys.argv[1]).resolve()
prototype = attempt / 'prototype'
root = Path(__file__).resolve().parents[2]
baseline = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root
read = lambda p: json.loads(p.read_text())
digest = lambda b: hashlib.sha256(b).hexdigest()
pre = read(prototype / 'predeclared.json')
for name, expected in pre['sources'].items():
    assert digest((baseline / name).read_bytes()) == expected
    assert digest(subprocess.check_output(['git', 'show', pre['revision'] + ':' + name], cwd=root)) == expected
for name, expected in pre['prototypeHashes'].items():
    assert digest((root / name).read_bytes()) == expected
assert digest((root / 'ai/diagnostics/task102-simulation-profile.cjs').read_bytes()) == pre['driverHash']
for name, expected in pre['checkpointHashes'].items():
    assert digest((Path(pre['checkpoint']) / name).read_bytes()) == expected
checks = {v['label']: v for v in read(prototype / 'checks.json')}
summary = []
for fixture in ['teacher', 'component']:
    original = json.loads(gzip.decompress((attempt / f'{fixture}-1-off.results.json.gz').read_bytes()))
    trace = read(attempt / f'{fixture}-1-off.trace.json')
    times = {'baseline': [], 'prototype': []}
    for index, variant in enumerate(['baseline', 'prototype', 'prototype', 'baseline'], 1):
        label = f'{fixture}-{index}-{variant}'
        run = read(prototype / (label + '.json'))
        data = (prototype / (label + '.results.json.gz')).read_bytes()
        assert digest(data) == run['resultsHash']
        assert json.loads(gzip.decompress(data)) == original
        assert checks[label]['exit'] == 0
        log = (prototype / (label + '.log')).read_text()
        assert f'SIMULATION_BATCH: PASS {fixture} off 6 complete retained results' in log
        assert '\nEXIT_CODE: 0\n' in log
        times[variant].append(run['gameMs'])
        print(f'PROTOTYPE_OUTCOMES: PASS {label} all six complete outcomes and examples; {run["gameMs"]:.6f} ms')
    label = fixture + '-trace-prototype'
    assert checks[label]['exit'] == 0
    assert read(prototype / (label + '.trace.json')) == trace, 'complete input/score/order/snapshot equivalence'
    data = (prototype / (label + '.results.json.gz')).read_bytes()
    run = read(prototype / (label + '.json'))
    assert digest(data) == run['resultsHash']
    assert json.loads(gzip.decompress(data)) == original
    log = (prototype / (label + '.log')).read_text()
    assert 'ALLOCATION_TRACE: PASS ' in log and '\nEXIT_CODE: 0\n' in log
    print(f'PROTOTYPE_TRACE: PASS {fixture} every original input, score, command and snapshot; retained examples identical')
    before = statistics.mean(times['baseline'])
    after = statistics.mean(times['prototype'])
    traced_baseline = [read(attempt / f'{fixture}-{i}-off.json')['gameMs'] for i in [1, 4]]
    entry = dict(fixture=fixture, timesMs=times, baselineMeanMs=before, prototypeMeanMs=after, reductionPercent=(before-after)/before*100, tracedBaselineMs=traced_baseline, traceSlowdownRatio=statistics.mean(traced_baseline)/before)
    summary.append(entry)
    print('PROTOTYPE_TIMING: ' + json.dumps(entry, sort_keys=True))
(prototype / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print('PROTOTYPE_AUDIT: PASS 60 complete outcomes and full trace equivalence; bounded diagnostic, not acceptance medians')
