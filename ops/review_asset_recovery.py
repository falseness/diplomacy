#!/usr/bin/env python3
"""Independent AC3 recovery turns, extending the retained AC2 oracle.

Reads raw input/wire/database observations; checkpoint expectations are unused.
No browser execution or current-source validity is inferred from pass flags.
"""
import copy
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
from review_version_gameplay import review as versions, canonical
from review_asset_archive import sha, DEP

CASES = ('cold-warm-delay', 'failed-recovery')


def review(root, digest):
    root = Path(root).resolve(strict=True)
    result = versions(root, digest)
    checks, proofs = result['checks'], result['proofs']
    manifest = json.loads((root/'coverage-results.json').read_text())['evidenceHashes']

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('asset-recovery: '+name)
        checks.append(dict(id='recovery/'+name, expected=expected, observed=observed, **{'pass': True}))

    def read(name, mode='json'):
        p = (root/name).resolve(strict=True)
        check('contained/'+name, True, p.is_relative_to(root) and p.is_file())
        check('binding/'+name, manifest[name], sha(p))
        proofs[name] = sha(p)
        text = p.read_text()
        return text if mode=='text' else [json.loads(l) for l in text.splitlines()] if mode=='lines' else json.loads(text)

    events = read('asset-events.jsonl', 'lines')
    requests = read('asset-requests.jsonl', 'lines')
    checkpoints = read('checkpoints.json')['checkpoints']
    durable = read('persistence-checkpoints.json')
    sources = read('source-identities.json')['after']['client']['files']
    for case in CASES:
        coop = case=='failed-recovery'
        own = [e for e in events if e['id']==case]
        fixture = read(case+'/declared-fixture.json')['board']
        check(case+'/fixture/round', 0, fixture['gameRound'])
        check(case+'/fixture/players', 4 if coop else 3, len(fixture['players']))
        check(case+'/fixture/gold', [0,200,200], [p['gold'] for p in fixture['players'][:3]])
        check(case+'/fixture/mover', dict(name='noob',coord=dict(x=3,y=6),hp=2,wasHitted=False,moves=2), fixture['players'][1]['units'][0])
        initial = canonical(fixture)
        for slot,income in [(1,9),(2,10)]:
            initial['players'][slot]['gold'] += income
        moved = copy.deepcopy(initial)
        moved['players'][1]['units'][0].update(coord=dict(x=3,y=5),moves=1)
        moved['grid'][3][5] = 1
        final = copy.deepcopy(moved)
        final['gameRound'] = 1
        final['players'][1]['units'][0]['moves'] = 2
        final['players'][1]['gold'] += 9
        final['players'][2]['gold'] += 10

        def observed(suffix):
            rows = [c['observed'] for c in checkpoints if c['id']==case+'/'+suffix]
            check(case+'/'+suffix+'/unique', 1, len(rows))
            return rows[0]

        for suffix,expected in [('initial/exact',initial),('round0/move/exact',moved),('round0/persisted/exact',moved),('round0/round/p1',final),('round0/round/p2',final)]:
            check(case+'/'+suffix, expected, observed(suffix))
        check(case+'/participants', dict(contexts=2,persisted=2), observed('participants'))
        check(case+'/connected-contexts', 2, next(c['observed']['contexts'] for c in checkpoints if c['id']==case+'/participants'))
        check(case+'/admission', [[dict(identity=0,slot=1),dict(identity=1,slot=2)]], [e['assigned'] for e in own if e['stage']=='admission'])
        check(case+'/complete', [dict(round=1,observers=2)], [{k:e[k] for k in ('round','observers')} for e in own if e['stage']=='round-complete'])
        for slot in (1,2):
            player = case+'-p'+str(slot)
            wire = [e for e in own if e['stage']=='wire' and e['player']==player]
            turns = [e for e in wire if e.get('event')=='nextTurn' and e['direction']=='sent']
            check(player+'/submissions', 1, len(turns))
            check(player+'/submitted', moved if slot==1 or coop else initial, canonical(turns[0]['args'][0]['json']['game']))
            incoming = [e for e in wire if e['direction']=='received' and e.get('event') in ('playYourTurn','waitYouTurn','gameStarted')]
            expected = [initial,moved,final] if coop else [initial,final]
            check(player+'/wire-count', len(expected), len(incoming))
            for index,(e,b) in enumerate(zip(incoming,expected)):
                check(player+'/wire-board-'+str(index), b, canonical(e['args'][0]['json']))
                check(player+'/wire-owner-'+str(index), slot, e['args'][0]['json']['whooseTurn'])
            check(player+'/submit-before-final', True, wire.index(turns[0])<wire.index(incoming[-1]))
            rows = [r for r in requests if r['id']==case and r['player']==player and 'sha256' in r]
            check(player+'/hashed-requests', True, bool(rows))
            for index,r in enumerate(rows):
                u = urlsplit(r['url']); name = u.path.lstrip('/') or 'index.html'
                if u.hostname=='127.0.0.1' and name in sources:
                    check(player+'/request-'+str(index)+'/'+name, sources[name], r['sha256'])
        for label in ['select fresh mover cell=3,6','fresh legal move after automatic recovery cell=3,5','commit fresh recovered turn','peer completes round']:
            check(case+'/input/'+label, 1, len([e for e in own if e['stage']=='input' and e.get('label')==label and e.get('via')=='mouse.click']))
        docs = [d for d in durable if d['id']==case]
        check(case+'/database/stages', ['accepted','round-complete'], [d['stage'] for d in docs])
        for d in docs:
            doc = d['document']; stage = d['stage']; rounds = doc['rounds']; complete = stage=='round-complete'
            check(case+'/'+stage+'/identities', [None,'[user-1]','[user-2]']+([None] if coop else []), doc['playerIndexToUserIndex'])
            check(case+'/'+stage+'/revision', (2 if complete else 1) if coop else 0, doc['coopRevision'])
            check(case+'/'+stage+'/rounds', 2 if complete else 1, len(rounds))
            for slot in (1,2):
                c = rounds[0][slot]
                check(case+'/'+stage+'/head'+str(slot), 1 if slot==1 or complete else 0, c['nextTurnIndex'])
                check(case+'/'+stage+'/turn-count'+str(slot), 1, len(c['turns']))
                turn = c['turns'][0]
                check(case+'/'+stage+'/owner'+str(slot), slot, turn['playerIndex'])
                if slot==1 or complete:
                    check(case+'/'+stage+'/persisted'+str(slot), moved if slot==1 or coop else initial, canonical(turn['gameObject']))
                else:
                    check(case+'/'+stage+'/unsubmitted', None, turn['gameObject'])
                if complete:
                    check(case+'/next-round/head'+str(slot), 0, rounds[1][slot]['nextTurnIndex'])
                    check(case+'/next-round/unsubmitted'+str(slot), None, rounds[1][slot]['turns'][0]['gameObject'])
        check(case+'/unexpected-browser-errors', [], read(case+'/browser-errors.json'))
        induced = read(case+'/induced-errors.json')
        expected_errors = [dict(player=case+'-p1',type='requestfailed',url=DEP,text='net::ERR_FAILED'),dict(player=case+'-p1',type='console.error',text='Failed to load resource: net::ERR_FAILED')] if coop else []
        check(case+'/induced-errors', expected_errors, induced)
        log = read(case+'/services/server.log','text')
        check(case+'/server-commits', True, '@@handleNextTurn 1' in log and '@@handleNextTurn 2' in log)
        for marker in ('Error handling game event:', 'TypeError','ReferenceError','RangeError','Unhandled'):
            check(case+'/server-errors/'+marker, False, marker in log)
    result.update(wholeCriterionClosure=True,scope='TASK-211/AC3: post asset recovery/reload, exact connected turn, requests/hashes and unexpected errors across all four retained cases',
                  derivation=result['derivation']+' Recovery cases independently apply the same initial income, adjacent move and round rules. Co-op peer receives and submits the moved shared board; competitive peer submits its initial board. All incoming boards and both persisted components are compared, including recipient ownership. Only the exact induced CDN error pair is allowed.')
    return result


if __name__=='__main__':
    print(json.dumps(review(sys.argv[1],sys.argv[2])))
