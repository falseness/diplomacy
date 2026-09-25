#!/usr/bin/env python3
"""Compare TASK-225 captured reload packets with persisted initial turn state.

This bounded diagnostic does not assign tiers or certify a whole archive.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path


def validate(root):
    root = Path(root)
    persisted = json.loads((root/'persisted.json').read_text())
    frames = [json.loads(line) for line in (root/'received-boards.jsonl').read_text().splitlines()]
    assert len(frames) == 2, 'exactly two inbound boards'
    rounds = persisted['rounds']
    assert len(rounds) == 1 and len(rounds[0]) == 2, 'initial single component'
    expected = copy.deepcopy(rounds[0][0]['parallelTurnResult'])
    assert expected['gameRound'] == 4, 'authored round four'
    assert expected['gameSettings']['coop']['generation']['version'] == 4, 'current format'
    # Saved preparation is evidence, not a call to the production turn routine.
    # Only slot one is pending in this initial two-human component.
    turns = rounds[0][1]['turns']
    assert [t['playerIndex'] for t in turns] == [1, 2], 'two human turn identities'
    assert all(t['gameObject'] is None for t in turns), 'no submitted turns'
    assert [t['playerIndex'] for t in turns if t.get('preparedTurnState')] == [1], 'one saved preparation'
    prepared = turns[0]['preparedTurnState']
    assert prepared['playerIndex'] == 1, 'prepared identity'
    assert prepared['player']['gold'] == 106, 'independent prepared income'
    assert expected['players'][2]['gold'] == 100, 'waiting income unchanged'
    expected['players'][1] = prepared['player']
    for name in ['external', 'externalProduction']:
        def owned(row):
            return expected['grid'][row['coord']['x']][row['coord']['y']] == 1
        expected[name] = [r for r in expected[name] if not owned(r)] + [r for r in prepared[name] if owned(r)]
    expected['timers'][1] = prepared['packedTimer']
    observations = []
    for frame, player, slot, event in zip(frames, ['p0', 'p1'], [1, 2], ['playYourTurn', 'waitYouTurn']):
        assert [frame['schemaVersion'], frame['kind'], frame['direction'], frame['player'], frame['event']] == [
            1, 'sanitized-inbound-board', 'received', player, event], 'schema/recipient/event'
        assert frame['transport'] in ['polling', 'websocket'], 'observed transport'
        expected['whooseTurn'] = slot
        expected['coopCommit'] = dict(gameID=persisted['gameID'], revision=0)
        assert set(frame['board']) == set(expected), 'exact board fields'
        for name, value in expected.items():
            assert frame['board'][name] == value, player+'/'+name
            observations.append(dict(id=player+'/'+name, expected=value, observed=frame['board'][name], passed=True))
    return dict(scope='Full inbound reload equality only; no tier or whole-target closure',
                passed=True, recipients=['p0', 'p1'], observations=observations,
                proofs={name: hashlib.sha256((root/name).read_bytes()).hexdigest()
                        for name in ['received-boards.jsonl', 'persisted.json']})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = validate(args.directory)
    with open(args.output, 'x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print('PASS full-reloaded-state/p0 full-reloaded-state/p1 exact-fields=' + str(len(report['observations'])))
