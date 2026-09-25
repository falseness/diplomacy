#!/usr/bin/env python3
"""Compare TASK-225 captured reload packets with persisted initial turn state.

This bounded diagnostic does not assign tiers or certify a whole archive.
"""
import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path


def validate(root, *, network_frames=None, run_window=None):
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
    # Do not let matching corruption of persistence and both packets become its
    # own oracle. This authored initial turn changes only the active gold balance.
    initial_player = expected['players'][1]
    assert initial_player['gold'] == 100, 'initial active income'
    assert initial_player['units'] == [dict(name='noob', coord=dict(x=x, y=y),
        hp=2, wasHitted=False, moves=2) for x, y in [(1,4),(2,4),(4,4),(6,4),(2,3)]], 'authored unit identities'
    expected_player = copy.deepcopy(initial_player)
    expected_player['gold'] = 106
    assert prepared['player'] == expected_player, 'independent prepared player'
    assert prepared['external'] == expected['external'], 'independent prepared external'
    assert prepared['externalProduction'] == expected['externalProduction'], 'independent prepared production'
    assert prepared['packedTimer'] == expected['timers'][1], 'independent prepared timer'
    expected['players'][1] = prepared['player']
    for name in ['external', 'externalProduction']:
        def owned(row):
            return expected['grid'][row['coord']['x']][row['coord']['y']] == 1
        expected[name] = [r for r in expected[name] if not owned(r)] + [r for r in prepared[name] if owned(r)]
    expected['timers'][1] = prepared['packedTimer']
    observations = []
    if (network_frames is None) != (run_window is None):
        raise ValueError('network frames and run window must be supplied together')
    if network_frames is not None:
        summaries = [r for r in network_frames if r.get('direction') == 'received'
                     and r.get('event') in ['playYourTurn', 'waitYouTurn']]
        assert len(summaries) == 2, 'exact reload summaries'
        stamp = lambda value: datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        start, end = map(stamp, run_window)
        assert start < end, 'valid parent run window'
    for frame, player, slot, event in zip(frames, ['p0', 'p1'], [1, 2], ['playYourTurn', 'waitYouTurn']):
        assert [frame['schemaVersion'], frame['kind'], frame['direction'], frame['player'], frame['event']] == [
            1, 'sanitized-inbound-board', 'received', player, event], 'schema/recipient/event'
        assert frame['transport'] in ['polling', 'websocket'], 'observed transport'
        if network_frames is not None:
            summary = summaries[slot-1]
            assert start <= stamp(frame['at']) <= end, 'inbound parent run window'
            assert start <= stamp(summary['at']) <= end, 'summary parent run window'
            # Callbacks serialize the packet before the summary; permit at most
            # one second of synchronous observer overhead, never another run.
            assert 0 <= (stamp(summary['at'])-stamp(frame['at'])).total_seconds() <= 1, 'same observed packet time'
            actual = [frame['player'], frame['event'], frame['transport'],
                      frame['board']['whooseTurn'], frame['board']['coopCommit'], frame['board']['gameRound']]
            want = [summary[k] for k in ['player','event','transport','whooseTurn','commit','gameRound']]
            assert actual == want, 'same observed packet identity'
            observations.append(dict(id=player+'/network-packet-binding', expected=want, observed=actual, passed=True))
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
