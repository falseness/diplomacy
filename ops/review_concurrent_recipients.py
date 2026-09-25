#!/usr/bin/env python3
"""Independent ten-recipient payload/roster proof; never a whole-clause claim."""
import argparse
import copy
import json
from pathlib import Path
from review_concurrent_archive import board, project, digest


def review(root):
    root = Path(root)
    names = ['recipient-bindings.json', 'recipient-packets.jsonl',
             'coop-ten-persisted-2.json', 'coop-ten-move-1-persisted.json',
             'coop-ten-move-2-persisted.json']
    proofs = {name: digest(root/name) for name in names}
    read = lambda n: json.loads((root/n).read_text())
    bindings = read(names[0])['bindings']
    packets = [json.loads(line) for line in (root/names[1]).read_text().splitlines()]
    doc = read('coop-ten-persisted-2.json')
    selected = [b for b in bindings if b['gameID'] == doc['gameID']]
    checks = []

    def check(name, expected, actual):
        if type(expected) is not type(actual) or expected != actual:
            raise ValueError('recipient-proof: '+name)
        checks.append(dict(id=name, expected=expected, observed=actual, passed=True))

    check('ten-slots', list(range(1, 11)), sorted(b['slot'] for b in selected))
    check('ten-distinct-peers', 10, len({b['peer'] for b in selected}))
    check('ten-distinct-users', 10, len({b['user'] for b in selected}))
    check('connection-uniqueness', sum(len(b['connections']) for b in bindings),
          len({c for b in bindings for c in b['connections']}))
    index = {b['peer']: b for b in bindings}
    for b in selected:
        check(b['peer']+'/roster', doc['playerIndexToUserIndex'], b['roster'])
        check(b['peer']+'/user', doc['playerIndexToUserIndex'][b['slot']], b['user'])
        check(b['peer']+'/connections', 2 if b['slot'] == 1 else 1, len(b['connections']))
    seen, observations = set(), 0
    for i, p in enumerate(packets):
        b = index.get(p['peer'])
        check('packet/'+str(i)+'/known-peer', True, b is not None)
        check('packet/'+str(i)+'/connection', True, p['connection'] in b['connections'])
        if b['gameID'] != doc['gameID'] or p['event'] not in ['gameStarted', 'playYourTurn', 'waitYouTurn']:
            continue
        prefix = 'ten-packet/'+str(i)
        check(prefix+'/arity', 1, len(p['bodies']))
        raw = p['bodies'][0]
        check(prefix+'/slot', b['slot'], raw['whooseTurn'])
        check(prefix+'/game', b['gameID'], raw['coopCommit']['gameID'])
        r, rev = raw['gameRound'], raw['coopCommit']['revision']
        check(prefix+'/revision-range', True, r in [0, 1, 2] and 10*r <= rev < 10*(r+1) and rev <= 20)
        moved = rev > 0
        expected = board('coop-ten', r, moved)
        if rev % 10:
            expected['players'][1]['units'][0]['coord']['y'] = 5 if r == 0 else 6
            expected['players'][1]['units'][0]['moves'] = 1
        check(prefix+'/independent-board', expected, project(raw))
        seen.add((b['slot'], rev))
        observations += 1
    check('every-recipient-every-revision', [(s, r) for s in range(1, 11) for r in range(21)], sorted(seen))
    for r in [1, 2]:
        intermediate = read('coop-ten-move-'+str(r)+'-persisted.json')
        check('intermediate/'+str(r)+'/game', doc['gameID'], intermediate['gameID'])
        expected = board('coop-ten', r-1, True)
        expected['players'][1]['units'][0]['coord']['y'] = 5 if r == 1 else 6
        expected['players'][1]['units'][0]['moves'] = 1
        turns = [t for c in intermediate['rounds'][-1] for t in c['turns']]
        check('intermediate/'+str(r)+'/submitted', expected, project(next(t['gameObject'] for t in turns if t['playerIndex'] == 1)))
    return dict(passRecipientProof=True, packetCount=observations, checkCount=len(checks),
                checks=checks, proofs=proofs, criterionClosures=[], fullAuditReady=False,
                scope='Ten protocol recipients only. Browser packets and whole AC2 review remain separate.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive'); p.add_argument('output')
    a = p.parse_args()
    result = review(a.archive)
    with open(a.output, 'x') as f:
        json.dump(result, f, indent=2); f.write('\n')
    print(f"PASS ten-recipient packets={result['packetCount']} checks={result['checkCount']} fullAuditReady=false")
