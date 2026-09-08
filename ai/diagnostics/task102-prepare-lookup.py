#!/usr/bin/env python3
"""Freeze archive-order lookup scenarios and all replay inputs before execution."""
import collections
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=False)
TASK = ROOT / 'artifacts/TASK-102'
SPEED = TASK / 'undo-ownership/full-speed'
ARCHIVE = SPEED / 'canonical-training-after-1-outcomes.jsonl'
STORAGE = SPEED / 'canonical-training-after-1'
read = lambda p: json.loads(p.read_text())
hash_file = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
classes = collections.defaultdict(list)
lines = [json.loads(line) for line in ARCHIVE.read_text().splitlines()]
for index, row in enumerate(lines):
    if row['event'] == 'start':
        assert lines[index + 1]['event'] == 'result'
        classes[row['scenario']['inferenceSource']].append((index, row['scenario'], lines[index + 1]['game']))
assert len(classes) == 4
scenarios = []
for group, rows in zip(['teacher', 'old-new', 'simple', 'baseline'], classes.values()):
    for pair, selected in [('early', rows[:2]), ('late', rows[-2:])]:
        for side_index, (index, scenario, expected) in enumerate(selected):
            identifier = scenario['modelIdentifier']
            checkpoints = []
            model_side = 'A' if side_index == 0 else 'B'
            if group == 'old-new':
                checkpoints = [STORAGE / identifier[key] for key in ['newCheckpoint', 'oldCheckpoint']]
                assert model_side == identifier['newModelSide']
            elif group in ['simple', 'baseline']:
                checkpoints = [STORAGE / 'checkpoints/task102-canonical' / f"step-{identifier['trainingStep']:08d}"]
                if group == 'baseline':
                    checkpoints.append(Path(identifier['baselineModelPath']))
            scenarios.append(dict(id=f'{group}-{pair}-{model_side}', group=group, pair=pair, archiveLine=index+1,
                                  scenario=scenario, expected=expected, checkpoints=list(map(str, checkpoints)), modelSide=model_side))
prior = read(TASK / 'objective-distance/simulation.json')
for index, scenario in enumerate(prior['component']):
    scenarios.append(dict(id=f'component-{index}', group='component', pair='fixture', scenario=scenario,
                          checkpoints=[prior['checkpoint']], modelSide='A'))
hashes = {}
# Freeze tracked runtime and all diagnostics; compare reused runtime to saved actual tree.
tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
for name in tracked + ['ai/diagnostics/task102-lookup-replay.cjs', 'ai/diagnostics/task102-prepare-lookup.py']:
    p = ROOT / name
    if p.is_file():
        hashes[str(p)] = hash_file(p)
for p in [ARCHIVE, SPEED / 'checkpoint-sha256.json', TASK / 'diagnosis.md']:
    hashes[str(p)] = hash_file(p)
archived_hashes = read(SPEED / 'checkpoint-sha256.json')
for item in scenarios:
    for directory in item['checkpoints']:
        directory = Path(directory)
        model = read(directory / 'model.json')
        names = ['model.json'] + [name for group in model['weightsManifest'] for name in group['paths']]
        for name in names:
            p = directory / name
            hashes[str(p)] = hash_file(p)
            if p.is_relative_to(STORAGE):
                assert archived_hashes[str(p.relative_to(SPEED))] == hashes[str(p)]
        metadata = directory / 'metadata.json'
        if metadata.exists():
            hashes[str(metadata)] = hash_file(metadata)
# Baseline and component checkpoint bytes are also frozen; saved external baseline provenance is checked separately.
manifest = dict(revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                status=subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True),
                archive=str(ARCHIVE), scenarios=scenarios, hashes=hashes,
                order=['control', 'scan', 'scan', 'control'], modes=['off', 'counts', 'trace'], heapMiB=6144,
                limitation='Replay omits fitting and full-process retained training data. No full-workload speed or learned-strength claim.')
(OUT / 'predeclared.json').write_text(json.dumps(manifest, indent=2) + '\n')
(OUT / 'initial-tasks.json').write_bytes((ROOT / 'artifacts/tasks.json').read_bytes())
print(f'PREDECLARATION: PASS {len(scenarios)} scenarios; archive-order first/last A/B pairs; {len(hashes)} frozen files')
print('ACTUAL_PREDECESSOR: ' + manifest['revision'])
