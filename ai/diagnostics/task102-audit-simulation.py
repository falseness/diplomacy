#!/usr/bin/env python3
"""Audit complete fixed-fixture results and summarize sampled game stacks."""
import collections
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

attempt = Path(sys.argv[1]).resolve()
read = lambda p: json.loads(p.read_text())
digest = lambda b: hashlib.sha256(b).hexdigest()
pre = read(attempt / 'predeclared.json')
root = Path(__file__).resolve().parents[2]
for name, expected in pre['sources'].items():
    assert digest((root / name).read_bytes()) == expected, name
    assert digest(subprocess.check_output(['git', 'show', pre['revision'] + ':' + name],
                                        cwd=root)) == expected, name
assert digest((root / 'ai/diagnostics/task102-simulation-profile.cjs').read_bytes()) == pre['driverHash']
for name, expected in pre['checkpointHashes'].items():
    assert digest((Path(pre['checkpoint']) / name).read_bytes()) == expected, name
assert pre['teacher'] == dict(seed=137087, stage=0, games=list(range(1, 7)))
assert pre['component'] == read(root / 'artifacts/TASK-102/bounded-profile/component.json')
assert pre['order'] == ['off', 'on', 'on', 'off'] and pre['samplingIntervalUs'] == 1000
print('SIMULATION_SOURCE: PASS actual predecessor ' + pre['revision'])
reference_teacher = json.loads(gzip.decompress(
    (root / 'artifacts/TASK-102/fitting-attribution/capture/examples.json.gz').read_bytes()))
reference_component = [entry['game'] for entry in read(root /
    'artifacts/TASK-102/bounded-profile/component-after-retain-on.json')['outcomes']]
summaries = []
checks = {check['label']: check for check in read(attempt / 'checks.json')}
for fixture in ['teacher', 'component']:
    reference = reference_teacher if fixture == 'teacher' else reference_component
    for index, mode in enumerate(pre['order'], 1):
        label = f'{fixture}-{index}-{mode}'
        run = read(attempt / (label + '.json'))
        data = (attempt / (label + '.results.json.gz')).read_bytes()
        assert digest(data) == run['resultsHash']
        results = json.loads(gzip.decompress(data))
        assert results == reference, label + ': all results and example values'
        assert [game['seed'] for game in results] == list(range(
            137088 if fixture == 'teacher' else 10200,
            137094 if fixture == 'teacher' else 10206))
        if fixture == 'teacher':
            assert sum(len(game['examples']) for game in results) == 13511
            assert [game['modelSide'] for game in results] == ['A', 'B'] * 3
        assert run['fixture'] == fixture and run['mode'] == mode
        assert len(run['outcomes']) == len(run['intervals']) == run['retainedCount'] == 6
        assert len(run['memory']) == 12
        assert abs(sum(i['end'] - i['begin'] for i in run['intervals']) - run['gameMs']) < 1e-6
        assert 0 < run['gameMs'] <= run['batchMs']
        assert run['node'] == 'v20.20.2' and '--max-old-space-size=6144' in run['execArgv']
        for game, outcome in zip(results, run['outcomes']):
            # Parse equality above covers all bytes' meaning; these compact hashes
            # independently compare all four JS-serialized passes without Python float formatting.
            first = read(attempt / f'{fixture}-1-off.json')['outcomes'][outcome['index']]
            assert outcome['hash'] == first['hash']
            assert outcome['result'] == (dict(game, examples=len(game['examples']))
                                         if fixture == 'teacher' else game)
            assert game['inference']['positions'] > 0
            if fixture == 'teacher':
                assert game['roundCount'] > 0
            else:
                assert game['roundCount'] == 0 and game['nonResult'] and game['timeout']
                assert game['winner'] is None and game['winnerSide'] is None
                assert game['runtimePlayerA'] == 'AIPlayer'
                assert game['runtimePlayerB'] == 'SimpleAiPlayer'
        assert checks[label]['exit'] == 0
        log = (attempt / (label + '.log')).read_text()
        assert log.count('SIMULATION_OUTCOME: ') == 6
        assert f'SIMULATION_BATCH: PASS {fixture} {mode} 6 complete retained results' in log
        assert 'EXIT_CODE: 0' in log
        summary = dict(label=label, gameMs=run['gameMs'], batchMs=run['batchMs'],
                       gcMs=sum(g['duration'] for g in run['gc']))
        if mode == 'on':
            profile = read(attempt / (label + '.cpuprofile'))
            nodes = {node['id']: node for node in profile['nodes']}
            parents = {child: node['id'] for node in nodes.values() for child in node.get('children', [])}
            assert len(profile['samples']) == len(profile['timeDeltas']) > 0
            own, inclusive = collections.Counter(), collections.Counter()
            stamp = profile['startTime']
            selected_us = 0
            def key(node_id):
                frame = nodes[node_id]['callFrame']
                return f'{frame["functionName"] or "(anonymous)"} {frame["url"]}:{frame["lineNumber"] + 1}'
            for node_id, delta in zip(profile['samples'], profile['timeDeltas']):
                stamp += delta
                # Only include samples ending inside a timed production call.
                # Clamp the first intersecting interval to avoid charging earlier logging.
                overlap = sum(max(0, min(stamp, i['cpuEndUs']) - max(stamp - delta, i['cpuBeginUs']))
                              for i in run['intervals'] if i['cpuBeginUs'] <= stamp <= i['cpuEndUs'])
                if not overlap:
                    continue
                own[key(node_id)] += overlap
                selected_us += overlap
                seen = set()
                while node_id in nodes:
                    seen.add(key(node_id))
                    node_id = parents.get(node_id)
                for name in seen:
                    inclusive[name] += overlap
            assert selected_us > run['gameMs'] * 1000 * .8, 'sample clock/interval coverage'
            assert selected_us <= run['gameMs'] * 1000 * 1.01
            summary.update(sampledGameMs=selected_us / 1000,
                           selfTop=[dict(frame=k, ms=v / 1000, percent=100 * v / selected_us)
                                    for k, v in own.most_common(25)],
                           inclusiveTop=[dict(frame=k, ms=v / 1000, percent=100 * v / selected_us)
                                         for k, v in inclusive.most_common(40)])
            print(f'SIMULATION_SAMPLES: PASS {label} {selected_us / 1000:.3f} ms; '
                  f'{len(profile["samples"])} raw samples')
        else:
            assert not (attempt / (label + '.cpuprofile')).exists()
        summaries.append(summary)
        print(f'SIMULATION_RESULTS: PASS {label} 6 full results identical to prior source-bound fixture; '
              f'game_ms={run["gameMs"]:.3f}')
with (attempt / 'summary.json').open('w') as output:
    json.dump(summaries, output, indent=2)
print('SIMULATION_AUDIT: PASS 48 complete outcomes; 13511 teacher examples per pass; diagnostic only')
