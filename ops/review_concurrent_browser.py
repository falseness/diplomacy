#!/usr/bin/env python3
"""Independent received browser boards and input milestones for concurrent AC2."""
import json
from pathlib import Path
from review_concurrent_archive import board, project, digest


def review(root):
    root = Path(root)
    names = ['wire.jsonl', 'inputs.jsonl', 'checkpoints.json', 'coop-browser-persisted-2.json',
             'competitive-browser-persisted-4.json']
    proofs = {n: digest(root/n) for n in names}
    packets = [json.loads(l) for l in (root/'wire.jsonl').read_text().splitlines()]
    inputs = [json.loads(l) for l in (root/'inputs.jsonl').read_text().splitlines()]
    checks = []

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('browser-proof: '+name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    check('connected-browser-contexts', 4, len({(p['id'], p['slot']) for p in packets}))
    counts = {}
    for i, p in enumerate(packets):
        if p['direction'] != 'received' or p.get('event') not in ['gameStarted', 'playYourTurn', 'waitYouTurn']:
            continue
        check('wire/'+str(i)+'/arity', 1, len(p['args']))
        raw = p['args'][0]['json']
        label, slot, r = p['id'], p['slot'], raw['gameRound']
        prefix = 'wire/'+str(i)
        check(prefix+'/recipient', slot, raw['whooseTurn'])
        check(prefix+'/known-label', True, label in ['coop-browser', 'competitive-browser'])
        check(prefix+'/known-slot', True, slot in [1, 2])
        check(prefix+'/round-bound', True, r in (range(3) if label == 'coop-browser' else range(5)))
        rev = raw.get('coopCommit', {}).get('revision')
        if label == 'coop-browser':
            doc = json.loads((root/'coop-browser-persisted-2.json').read_text())
            check(prefix+'/game', doc['gameID'], raw['coopCommit']['gameID'])
            check(prefix+'/revision', True, rev in [2*r, 2*r+1] and rev <= 4)
        expected = board(label, r, r > 0 or (rev is not None and rev > 0))
        check(prefix+'/board', expected, project(raw))
        key = (label, slot, r, rev)
        counts[key] = counts.get(key, 0)+1
    for label, rounds in [('coop-browser', 2), ('competitive-browser', 4)]:
        for slot in [1, 2]:
            for r in range(rounds+1):
                rev = r*2 if label == 'coop-browser' else None
                check(f'{label}/p{slot}/round{r}/deliveries', 2 if r == 1 and slot == 1 else 1,
                      counts.get((label, slot, r, rev), 0))
            actions = [x.get('label') for x in inputs if x['player'] == label+'-p'+str(slot)]
            check(f'{label}/p{slot}/submissions', rounds, actions.count('interleaved human submission'))
            if slot == 1:
                check(label+'/move-input', 1, actions.count('move independent army cell=3,5'))
                check(label+'/reconnect-input', 1, actions.count('identity reconnect'))
    return dict(checks=checks, proofs=proofs, browserPacketChecks=len(checks), fullAuditReady=False)
