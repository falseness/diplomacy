#!/usr/bin/env python3
"""Check frozen preparation attribution without promoting it to a speed gate."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

attempt = Path(sys.argv[1]).resolve()
capture = Path(sys.argv[2]).resolve()
repo = Path(__file__).resolve().parents[2]
read = lambda path: json.loads(path.read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
pre = read(attempt / 'capture/predeclared.json')
for name, expected in pre['prior']['sources'].items():
    assert digest((repo / name).read_bytes()) == expected, name
    assert digest(subprocess.check_output(
        ['git', 'show', pre['revision'] + ':' + name], cwd=repo)) == expected, name
for name, expected in pre['prior']['checkpointHashes'].items():
    assert digest(Path(name).read_bytes()) == expected, name
for name, expected in pre['captureHashes'].items():
    assert digest((capture / name).read_bytes()) == expected, name
assert digest((repo / 'ai/diagnostics/task102-preparation-profile.cjs').read_bytes()) == pre['driverHash']
assert digest((attempt / 'capture/instrumented-source.js').read_bytes()) == pre['transformedHash']
inputs = read(capture / 'frozen-inputs.json')
for item in inputs:
    assert digest((capture / item['name']).read_bytes()) == item['hash'], item['name']
outcomes = read(capture / 'outcomes.json')
assert len(outcomes) == 6
assert sum(o['game']['inference']['calls'] for o in outcomes) == len(inputs) == 269
assert sum(o['game']['inference']['positions'] for o in outcomes) == 7848
print('SOURCE_INPUT_CHECKPOINT: PASS actual predecessor ' + pre['revision'])
print('OUTCOME_ACCOUNTING: PASS 6 inherited outcomes; 269 calls; 7848 positions; no new games')
runs = read(attempt / 'capture/timings.json')
assert [r['mode'] for r in runs] == pre['order'] == ['original', 'instrumented', 'instrumented', 'original']
for i, run in enumerate(runs, 1):
    assert run == read(attempt / f'capture/pass-{i}.json')
    assert len(run['comparisons']) == len(inputs)
    assert run['stats']['calls'] == len(inputs)
    assert run['stats']['positions'] == 7848
    for comparison, item in zip(run['comparisons'], inputs):
        expected = digest(json.dumps(item['values'], separators=(',', ':')).encode())
        assert comparison == dict(name=item['name'], positions=item['positions'],
                                  expectedHash=expected, actualHash=expected)
    assert run['totalMs'] > 0 and run['projectionMs'] > 0 and run['projectionFlattenMs'] > 0
    assert abs(run['totalMs'] - sum(run['phases'].values()) - run['residualMs']) < 1e-6
    if run['mode'] == 'instrumented':
        assert set(run['phases']) == {'adaptation', 'boardTensor', 'flatten', 'globalTensor',
                                     'backend', 'readAndConvert', 'predictionDispose', 'inputDispose'}
        assert all(value >= 0 for value in run['phases'].values())
        print('ISOLATED_PHASES: ' + json.dumps({k: round(100 * v / run['totalMs'], 3)
                                              for k, v in run['phases'].items()}))
    print(f"PASS_{i}: {run['mode']} predictor={run['totalMs']:.3f}ms "
          f"canonical_projection_only={run['projectionMs']:.3f}ms "
          f"canonical_flatten_only={run['projectionFlattenMs']:.3f}ms; 269 exact comparisons")
log = (attempt / 'profile.log').read_text()
assert log.count('PREPARATION_PHASES: ') == 4
for marker in ['PREPARATION_EQUIVALENCE: PASS all 269 calls and 7848 positions in all four passes',
               'PREPARATION_PROFILE: PASS diagnostic only;', 'EXIT_CODE: 0']:
    assert marker in log, marker
print('PREPARATION_AUDIT: PASS all hashes, phase accounting and 1076 output comparisons; no speed-gate claim')
