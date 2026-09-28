#!/usr/bin/env python3
"""Summarize a completed diagnostic; sampling never establishes a gameplay fix."""
import collections
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
network = root / 'network'
receipt = json.loads((root / 'process-exit.json').read_text())
self_time, inclusive = collections.Counter(), collections.Counter()
total = 0
profiles = {}
for file in sorted(network.glob('server-cpu-*.json')):
    profile = json.loads(file.read_text())
    profiles[str(file.relative_to(root))] = hashlib.sha256(file.read_bytes()).hexdigest()
    nodes = {node['id']: node for node in profile['nodes']}
    parents = {child: node['id'] for node in nodes.values() for child in node.get('children', [])}
    assert len(profile['samples']) == len(profile['timeDeltas']), 'incomplete CPU samples'
    for index, delta in zip(profile['samples'], profile['timeDeltas']):
        total += delta
        frame = nodes[index]['callFrame']
        self_time[(frame['functionName'], frame['url'])] += delta
        seen = set()
        while index is not None:
            frame = nodes[index]['callFrame']
            seen.add((frame['functionName'], frame['url']))
            index = parents.get(index)
        # Recursive functions count each sample once, not once per stack frame.
        for frame in seen:
            inclusive[frame] += delta
assert profiles and total > 0, 'missing sampled CPU evidence'
events = [json.loads(line) for line in (network / 'passive-join-timing.jsonl').read_text().splitlines()]
sent = {row['connection']: row['atMs'] for row in events if row['event'] == 'sent-startGameOrConnect'}
initial = {}
for row in events:
    if row.get('hasBoard') and row['connection'] not in initial:
        initial[row['connection']] = dict(slot=row['slot'], latencyMs=row['atMs'] - sent[row['connection']])

def ranked(counter):
    return [dict(function=key[0], url=key[1], sampledMs=value / 1000,
                 percent=100 * value / total) for key, value in counter.most_common(30)]

report = dict(diagnosticOnly=True, actualExit=receipt['actualExit'], timedOut=receipt['timedOut'],
              initialBoards=initial, profiles=profiles, sampledMs=total / 1000,
              self=ranked(self_time), inclusive=ranked(inclusive),
              limits=['Profiles sample the whole network workload, including joins and holds; they are not per-join call counts.',
                      'Sampling perturbs timing. The unfinished interval at server termination is absent.',
                      'A passing unchanged diagnostic does not explain earlier failures or prove a repair.',
                      'No browser, complete provider or full TASK-225 coverage is established.'])
with (root / 'profile-summary.json').open('x') as stream:
    json.dump(report, stream, indent=2)
    stream.write('\n')
print(f"PROFILE_SUMMARY profiles={len(profiles)} initialBoards={len(initial)} actualExit={receipt['actualExit']} diagnosticOnly=true")
