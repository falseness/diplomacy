#!/usr/bin/env python3
"""Audit allocation owners and complete fixed-fixture equivalence; no speed claim."""
import collections
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

attempt = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[2]
baseline = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root
read = lambda p: json.loads(p.read_text())
digest = lambda b: hashlib.sha256(b).hexdigest()
pre = read(attempt / 'predeclared.json')
for name, expected in pre['sources'].items():
    assert digest((baseline / name).read_bytes()) == expected, name
    assert digest(subprocess.check_output(['git', 'show', pre['revision'] + ':' + name], cwd=root)) == expected, name
for name, key in [('task102-allocation-profile.cjs', 'driverHash'), ('task102-allocation-hooks.cjs', 'hooksHash')]:
    assert digest((root / 'ai/diagnostics' / name).read_bytes()) == pre[key]
for name, expected in pre['checkpointHashes'].items():
    assert digest((Path(pre['checkpoint']) / name).read_bytes()) == expected
print('ALLOCATION_SOURCE: PASS actual predecessor ' + pre['revision'])
assert pre['order'] == ['off', 'on', 'on', 'off']
reference_pre = read(root / 'artifacts/TASK-102/simulation-attribution/predeclared.json')
assert pre['component'] == reference_pre['component'] and pre['teacher'] == reference_pre['teacher']
checks = {v['label']: v for v in read(attempt / 'checks.json')}
summaries = []
for fixture in ['teacher', 'component']:
    reference = json.loads(gzip.decompress((root / f'artifacts/TASK-102/simulation-attribution/{fixture}-1-off.results.json.gz').read_bytes()))
    first_trace = None
    for index, mode in enumerate(pre['order'], 1):
        label = f'{fixture}-{index}-{mode}'
        run = read(attempt / (label + '.json'))
        data = (attempt / (label + '.results.json.gz')).read_bytes()
        assert digest(data) == run['resultsHash']
        assert json.loads(gzip.decompress(data)) == reference, label
        assert checks[label]['exit'] == 0
        log = (attempt / (label + '.log')).read_text()
        assert f'ALLOCATION_BATCH: PASS {fixture} {mode} 6 complete retained results' in log
        assert 'ALLOCATION_TRACE: PASS ' in log and '\nEXIT_CODE: 0\n' in log
        trace = read(attempt / (label + '.trace.json'))
        assert trace
        if first_trace is None:
            first_trace = trace
        assert trace == first_trace, label + ' every prediction input, score, command and snapshot'
        counts = collections.Counter(v['kind'] for v in trace)
        assert counts['inputs'] == counts['scores'] > 0
        assert counts['commands'] == counts['accepted'] > 0
        assert counts['snapshot'] > 0
        summary = dict(label=label, gameMs=run['gameMs'], gcMs=sum(v['duration'] for v in run['gc']), memory=run['memory'], counts=dict(counts), snapshotNumericPayloadEstimate=sum(v['meta']['channels'] * 8 for v in trace if v['kind'] == 'snapshot'))
        if mode == 'on':
            profile = read(attempt / (label + '.heapprofile'))
            assert profile['samples']
            owners = collections.Counter()
            sites = collections.Counter()
            def walk(node, stack):
                frame = node['callFrame']
                stack = stack + [(frame['functionName'], frame['url'], frame['lineNumber'])]
                size = node['selfSize']
                names = [v[0] for v in stack]
                # Original producer frames override outer observational wrappers.
                if 'cloneVectorGridCells' in names and 'cloneMutableVectorGridForPrediction' in names:
                    owner = 'candidate-snapshot'
                elif any(v in names for v in ['applyChangedCellFastAction', 'undoChangedCellFastAction']):
                    owner = 'fast-action-apply-undo'
                elif any('interactionWithUnit.js' in v[1] and v[0] in ['create', 'initialization', 'sortNeighbours', 'notUsedHandler', 'changeFogOfWarByVision'] for v in stack):
                    owner = 'movement-BFS'
                elif any('actionManager' in v[1] for v in stack):
                    owner = 'normal-action-undo'
                elif 'getWinningChances' in names:
                    owner = 'prediction'
                elif 'allocationSink' in names or any(n.startswith('AIPlayer.') for n in names):
                    owner = 'trace-hooks'
                else:
                    owner = 'other'
                owners[owner] += size
                sites[(owner, ' > '.join(f'{n}@{u}:{line+1}' for n,u,line in stack[-6:]))] += size
                for child in node.get('children', []):
                    walk(child, stack)
            walk(profile['head'], [])
            summary.update(estimatedAllocatedBytes=dict(owners), topSites=[dict(owner=k[0], stack=k[1], bytes=v) for k,v in sites.most_common(40)])
            print('ALLOCATION_OWNERS: ' + label + ' ' + json.dumps(dict(owners), sort_keys=True))
        summaries.append(summary)
        print(f'ALLOCATION_EQUIVALENCE: PASS {label} 6 complete outcomes; {counts["inputs"]} inputs/scores; {counts["snapshot"]} snapshots; {counts["commands"]} ordered command batches')
(attempt / 'summary.json').write_text(json.dumps(summaries, indent=2) + '\n')
print('ALLOCATION_AUDIT: PASS 48 complete outcomes and all input/score/order/snapshot traces; diagnostic only')
