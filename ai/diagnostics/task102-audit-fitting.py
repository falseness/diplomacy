#!/usr/bin/env python3
"""Independently audit the fixed-data ranking diagnostic, never a speed gate."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

attempt = Path(sys.argv[1]).resolve()
capture = attempt / 'capture'
root = Path(__file__).resolve().parents[2]
read = lambda path: json.loads(path.read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
pre = read(capture / 'predeclared.json')
for name, expected in pre['sources'].items():
    assert digest((root / name).read_bytes()) == expected, name
    assert digest(subprocess.check_output(
        ['git', 'show', pre['revision'] + ':' + name], cwd=root)) == expected, name
assert digest((root / 'ai/diagnostics/task102-fitting-profile.cjs').read_bytes()) == pre['driverHash']
for name, expected in pre['checkpointHashes'].items():
    assert digest((Path(pre['checkpoint']) / name).read_bytes()) == expected, name
assert pre['teacherSeed'] == 137087 and pre['stage'] == 0
assert pre['gameCount'] == 6 and pre['epochs'] == 20
print('FITTING_SOURCE_CHECKPOINT: PASS actual predecessor ' + pre['revision'])
metadata = read(capture / 'capture.json')
data = (capture / 'examples.json.gz').read_bytes()
assert digest(data) == metadata['hash']
games = json.loads(gzip.decompress(data))
assert len(games) == 6
assert sum(len(game['examples']) for game in games) == metadata['examples']
pair_count = 0
for game, scenario, outcome in zip(games, pre['scenarios'], metadata['outcomes']):
    assert {k: game[k] for k in scenario} == scenario
    assert {**game, 'examples': len(game['examples'])} == outcome
    assert game['roundCount'] > 0 and game['inference']['positions'] == len(game['examples'])
    groups = {}
    for example in game['examples']:
        groups.setdefault(example['choiceSet'], []).append(example)
    for group in groups.values():
        alternatives = len(group) - 1
        if alternatives:
            stride = max(1, alternatives // 8)
            pair_count += len(range(0, alternatives, stride))
    print('FITTING_OUTCOME: ' + json.dumps(outcome, sort_keys=True))
assert [game['modelSide'] for game in games] == ['A', 'B'] * 3
print(f'FITTING_INPUTS: PASS 6 unique scenarios; {metadata["examples"]} examples; {pair_count} ranking pairs')
runs = read(capture / 'timings.json')
assert [run['mode'] for run in runs] == pre['order'] == ['original', 'instrumented', 'instrumented', 'original']
for index, run in enumerate(runs, 1):
    assert run == read(capture / f'pass-{index}.json')
    assert digest((capture / f'weights-{index}.bin').read_bytes()) == run['weightHash'] == runs[0]['weightHash']
    assert run['loss'] == runs[0]['loss'] and len(run['loss']) == pre['epochs']
    assert run['totalMs'] > 0
    if run['mode'] == 'instrumented':
        assert len(run['fitEvents']) == 1
        event = run['fitEvents'][0]
        assert event['inputShapes'] == [[pair_count, 3, 3, 21], [pair_count, 1]] * 2
        assert event['options'] == dict(epochs=20, batchSize=128, shuffle=False, verbose=0)
        assert 0 < event['ms'] < run['totalMs']
        assert abs(run['totalMs'] - event['ms'] - run['residualMs']) < 1e-6
    else:
        assert not run['fitEvents'] and run['residualMs'] is None
    print(f'FITTING_PASS_{index}: {run["mode"]} total_ms={run["totalMs"]:.3f} residual_ms={run["residualMs"]}; weights/loss identical')
log = (attempt / 'profile.log').read_text()
assert log.count('TEACHER_OUTCOME: ') == 6
assert log.count('FITTING_PHASES: ') == 4
for marker in ['FITTING_EQUIVALENCE: PASS 4 identical loss histories and trained weight hashes',
               'FITTING_PROFILE: PASS diagnostic only; no canonical speed-gate claim', 'EXIT_CODE: 0']:
    assert marker in log, marker
print('FITTING_AUDIT: PASS source, checkpoint, inputs, all outcomes and four trained-weight comparisons; diagnostic only')
