#!/usr/bin/env python3
"""Audit complete frozen-input diagnostic evidence; never certify speed gates."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
repo = Path(__file__).resolve().parents[2]
capture = root / 'capture'


def read(name):
    return json.loads((capture / name).read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


pre = read('predeclared.json')
for name, expected in pre['sources'].items():
    assert digest((repo / name).read_bytes()) == expected, name
    blob = subprocess.check_output(['git', 'show', pre['revision'] + ':' + name], cwd=repo)
    assert digest(blob) == expected, name
for name, expected in pre['checkpointHashes'].items():
    assert digest(Path(name).read_bytes()) == expected, name
assert digest((repo / 'ai/diagnostics/task102-inference-profile.cjs').read_bytes()) == pre['driverHash']
print('SOURCE_CHECKPOINT_DRIVER: PASS actual revision ' + pre['revision'])
inputs = read('frozen-inputs.json')
for item in inputs:
    assert digest((capture / item['name']).read_bytes()) == item['hash'], item['name']
    assert item['positions'] == len(item['values']) > 0
outcomes = read('outcomes.json')
assert len(outcomes) == len(pre['scenarios']) == 6
assert [item['scenario'] for item in outcomes] == pre['scenarios']
assert len({item['scenario']['seed'] for item in outcomes}) == 6
prior = json.loads((repo / 'artifacts/TASK-102/bounded-profile/canonical-after-retain-on.json').read_text())
assert [item['game'] for item in outcomes] == [item['game'] for item in prior['outcomes']]
assert sum(item['game']['inference']['calls'] for item in outcomes) == len(inputs)
positions = sum(item['positions'] for item in inputs)
assert sum(item['game']['inference']['positions'] for item in outcomes) == positions
print(f'CAPTURE_ACCOUNTING: PASS {len(inputs)} calls {positions} positions; 6/6 full outcomes identical to bounded replay')
print('OUTCOMES: ' + json.dumps([{'seed': item['scenario']['seed'], 'side': item['game']['winnerSide'],
    'rounds': item['game']['roundCount'], 'nonResult': item['game']['nonResult']} for item in outcomes]))
runs = read('timings.json')
assert [run['mode'] for run in runs] == pre['order'] == ['off', 'on', 'on', 'off']
for run in runs:
    assert run['calls'] == len(inputs) and run['totalMs'] > 0
    if run['mode'] == 'on':
        assert abs(run['totalMs'] - sum(run['phases'].values()) - run['residualMs']) < 1e-5
        assert run['residualMs'] > 0
        print('ATTRIBUTION: ' + json.dumps({**run, 'residualPercent': 100 * run['residualMs'] / run['totalMs']}))
log = (root / 'profile.log').read_text()
for marker in ['OUTPUT_EQUIVALENCE: PASS every call and score in all four predeclared passes',
               'INFERENCE_PROFILE: PASS diagnostic only;', 'EXIT_CODE: 0']:
    assert marker in log, marker
assert log.count('CAPTURE_START: ') == log.count('CAPTURE_RESULT: ') == 6
assert log.count('FROZEN_REPLAY: ') == 4
print('INFERENCE_AUDIT: PASS hashes, all outcomes, all passes and exact output comparisons; no acceptance-speed claim')
