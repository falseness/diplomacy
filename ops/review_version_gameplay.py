#!/usr/bin/env python3
"""Independent compatibility gameplay review of a hash-bound retained provider.

No checkpoint expected/pass field is an oracle. This reader does not launch
services, alter archives, or change the independently measured source validity.
"""
import copy
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
from review_version_archive import review as rejection
from review_asset_archive import sha

CASES = ('old-client', 'old-server')


def canonical(b):
    def coord(c):
        return {k: c[k] for k in ('x', 'y')}

    def entity(e):
        out = dict(name=e['name'], coord=coord(e['coord']), hp=e.get('hp'), wasHitted=e.get('wasHitted'))
        for key in ('moves', 'category'):
            if key in e:
                out[key] = e[key]
        if 'unitProduction' in e:
            p = e['unitProduction']
            out['unitProduction'] = ({k: p[k] for k in ('name', 'turns', 'cost')} if p.get('name') not in (None, 'Empty') else {'name': 'Empty'})
        return out

    def live(xs, fn):
        return [fn(x) for x in xs if not x.get('killed')]

    def queue(q):
        return dict(name=q['name'], coord=coord(q['coord']), turns=q['turns'])

    def town(t):
        return dict(**entity(t), isRecentlyCaptured=bool(t.get('isRecentlyCaptured')),
                    suburbs=[dict(**coord(h.get('coord', h)), isSuburb=bool(h.get('isSuburb'))) for h in t['suburbs']],
                    buildings=live(t['buildings'], entity), buildingProduction=live(t['buildingProduction'], queue))

    return dict(gameRound=b['gameRound'], grid=copy.deepcopy(b['grid']),
                players=[dict(gold=p['gold'], units=live(p['units'], entity), towns=live(p['towns'], town)) for p in b['players']],
                external=live(b['external'], entity), externalProduction=live(b['externalProduction'], queue),
                nature=sorted(live(b['nature'], lambda e: dict(name=e['name'], coord=coord(e['coord']))), key=lambda e: (e['coord']['x'], e['coord']['y'], e['name'])),
                goldmines=live(b['goldmines'], lambda e: dict(name=e['name'], coord=coord(e['coord']), income=e['income'])))


def review(root, digest):
    root = Path(root).resolve(strict=True)
    prior = rejection(root, digest)
    checks, proofs = prior['checks'], prior['proofs']
    manifest = json.loads((root/'coverage-results.json').read_text())['evidenceHashes']

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('version-gameplay: '+name)
        checks.append(dict(id='gameplay/'+name, expected=expected, observed=observed, **{'pass': True}))

    def read(name, mode='json'):
        p = (root/name).resolve(strict=True)
        check('contained/'+name, True, p.is_relative_to(root) and p.is_file())
        check('binding/'+name, manifest[name], sha(p))
        proofs[name] = sha(p)
        if mode == 'bytes':
            return p.read_bytes()
        text = p.read_text()
        return text if mode == 'text' else ([json.loads(l) for l in text.splitlines()] if mode == 'lines' else json.loads(text))

    ids = read('source-identities.json')['after']
    sources = {}
    # The runtime-to-release chain is the executed, source-bound test branch,
    # extractor and real spawn cwd. A matrix's release label cannot replace it.
    for name in ['tests/reliability/assets-versions.test.js', 'tests/reliability/helpers/assets-release.js',
                 'tests/reliability/helpers/assets-old-platform.js', 'tests/reliability/helpers/services.js',
                 'tests/reliability/helpers/building-state.js']:
        p = Path(ids['server']['repo'])/name
        check('executed-source/'+name, ids['server']['files'][name], sha(p))
        sources[name] = p.read_text()
        proofs[str(p)] = sha(p)
    for name, fragments in {
        'assets-versions.test.js': ["id==='old-server'?{serverCwd:release.server", "id==='old-client'?release.client:undefined", "await release.close()", "await player.screenshot('version-rejected')", "onlineLobbyText().includes('Reload required: unsupported browser version')"],
        'helpers/assets-release.js': ["execFileSync('tar',['-xzf',archive,'-C',root])", "server:path.join(root,'diplomacy_server/server')", "actual!==h", "release bytes changed"],
        'helpers/services.js': ["serverCwd = serverDir", "'index.js'], {cwd: serverCwd"],
    }.items():
        for i, fragment in enumerate(fragments):
            check('runtime-selection/'+name+'/'+str(i), True, fragment in sources['tests/reliability/'+name])
    stdout = read('children/001-reliability_assets-versions/stdout.log', 'text')
    runtime = [json.loads(l.split('runtime ', 1)[1]) for l in stdout.splitlines() if l.startswith('# runtime ')]
    check('runtime/four-launches', 4, len(runtime))
    for i, r in enumerate(runtime):
        check('runtime/node/'+str(i), 'v20.20.2', r['node'])
        check('runtime/chromium/'+str(i), '125.0.6422.26', r['chromium'])
        check('runtime/mongo/'+str(i), 'db version v7.0.37', r['services']['mongod'])
    events = read('asset-events.jsonl', 'lines')
    checkpoints = read('checkpoints.json')['checkpoints']
    durable = read('persistence-checkpoints.json')
    requests = read('asset-requests.jsonl', 'lines')
    release = read('release-identities.json')
    for case in CASES:
        def observed(suffix):
            found = [c['observed'] for c in checkpoints if c['id'] == case+'/'+suffix]
            check(case+'/'+suffix+'/unique', 1, len(found))
            return found[0]
        case_requests = [r for r in requests if r['id']==case and 'sha256' in r]
        for slot in (1,2):
            own_requests = [r for r in case_requests if r['player']==case+'-p'+str(slot)]
            html = [r for r in own_requests if urlsplit(r['url']).path=='/']
            check(case+'/p'+str(slot)+'/html-present', True, bool(html))
            old_origin = urlsplit(html[0]['url']).netloc if case=='old-client' else None
            expected_html = [ids['client']['files']['index.html']]
            if case=='old-client':
                expected_html.append(release['files']['diplomacy/index.html'])
            check(case+'/p'+str(slot)+'/release-html', sorted(expected_html), sorted({r['sha256'] for r in html}))
            for i,r in enumerate(own_requests):
                url=urlsplit(r['url']); name=url.path.lstrip('/') or 'index.html'
                source = ({n.removeprefix('diplomacy/'):v for n,v in release['files'].items() if n.startswith('diplomacy/')}
                          if url.netloc==old_origin else ids['client']['files'])
                if url.hostname=='127.0.0.1' and name in source:
                    check(case+'/p'+str(slot)+'/request-'+str(i)+'/'+name, source[name], r['sha256'])
        if case=='old-client':
            cache=read('old-client/old-client-p1-assets.json')
            check('old-client/cached-online-logic', True, any(urlsplit(u).path=='/options/onlineLogic.js' for u in cache['cachedRequests']))
        fixture = read(case+'/declared-fixture.json')['board']
        check(case+'/fixture/round', 0, fixture['gameRound'])
        check(case+'/fixture/players', 3, len(fixture['players']))
        check(case+'/fixture/gold', [0,200,200], [p['gold'] for p in fixture['players']])
        check(case+'/fixture/mover', dict(name='noob',coord={'x':3,'y':6},hp=2,wasHitted=False,moves=2), fixture['players'][1]['units'][0])
        initial = canonical(fixture)
        # Town income +10, one field noob upkeep -1; town garrisons cost zero.
        for slot, income in [(1,9),(2,10)]:
            initial['players'][slot]['gold'] += income
        moved = copy.deepcopy(initial)
        moved['players'][1]['units'][0].update(coord=dict(x=3,y=5), moves=1)
        moved['grid'][3][5] = 1
        final = copy.deepcopy(moved)
        final['gameRound'] = 1
        final['players'][1]['units'][0]['moves'] = 2
        final['players'][1]['gold'] += 9
        final['players'][2]['gold'] += 10
        for name, expected in [('initial/exact', initial), ('round0/move/exact', moved),
                               ('round0/persisted/exact', moved), ('round0/round/p1', final), ('round0/round/p2', final)]:
            check(case+'/'+name, expected, observed(name))
        participants = observed('participants')
        check(case+'/participants', dict(contexts=2,persisted=2), participants)
        check(case+'/connected-contexts', 2, participants['contexts'])
        own = [e for e in events if e['id'] == case]
        check(case+'/admission', [[dict(identity=0,slot=1),dict(identity=1,slot=2)]], [e['assigned'] for e in own if e['stage']=='admission'])
        check(case+'/completion', [dict(round=1,observers=2)], [{k:e[k] for k in ('round','observers')} for e in own if e['stage']=='round-complete'])
        for slot in (1,2):
            player = case+'-p'+str(slot)
            wire = [e for e in own if e['stage']=='wire' and e['player']==player]
            upgraded = next(i for i,e in enumerate(wire) if e.get('engine')=='40{"browserProtocol":1}' and e['direction']=='sent')
            wire = wire[upgraded:]
            turns = [e for e in wire if e.get('event')=='nextTurn' and e['direction']=='sent']
            check(player+'/submission-count', 1, len(turns))
            check(player+'/submitted-board', moved if slot==1 else initial, canonical(turns[0]['args'][0]['json']['game']))
            incoming = [e for e in wire if e.get('event') in ('playYourTurn','waitYouTurn','gameStarted') and e['direction']=='received']
            check(player+'/round-sequence', [0,1], [e['args'][0]['json']['gameRound'] for e in incoming])
            check(player+'/slot', [slot,slot], [e['args'][0]['json']['whooseTurn'] for e in incoming])
            # Wire boards precede local turn preparation; verify exact persisted
            # and received own component separately below, not a packet label.
            for j,e in enumerate(incoming):
                packet=e['args'][0]['json']
                check(player+'/wire-board-'+str(j), initial if j==0 else final, canonical(packet))
        for label in ['select fresh mover cell=3,6', 'fresh legal move after automatic recovery cell=3,5', 'commit fresh recovered turn', 'peer completes round']:
            hits=[e for e in own if e['stage']=='input' and e.get('label')==label and e.get('via')=='mouse.click']
            check(case+'/input/'+label, 1, len(hits))
        docs = [d for d in durable if d['id']==case]
        check(case+'/database/stages', ['accepted','round-complete'], [d['stage'] for d in docs])
        for d in docs:
            doc=d['document']; stage=d['stage']; rounds=doc['rounds']
            check(case+'/'+stage+'/participants', [None,'[user-1]','[user-2]'], doc['playerIndexToUserIndex'])
            check(case+'/'+stage+'/rounds', 1 if stage=='accepted' else 2, len(rounds))
            for slot in (1,2):
                c=rounds[0][slot]
                check(case+'/'+stage+'/head'+str(slot), 1 if slot==1 or stage=='round-complete' else 0, c['nextTurnIndex'])
                check(case+'/'+stage+'/turn-count'+str(slot), 1, len(c['turns']))
                turn=c['turns'][0]
                check(case+'/'+stage+'/owner'+str(slot), slot, turn['playerIndex'])
                if slot==1 or stage=='round-complete':
                    check(case+'/'+stage+'/persisted'+str(slot), moved if slot==1 else initial, canonical(turn['gameObject']))
                else:
                    check(case+'/'+stage+'/unsubmitted', None, turn['gameObject'])
            if stage=='round-complete':
                for slot in (1,2):
                    check(case+'/next-round/head'+str(slot), 0, rounds[1][slot]['nextTurnIndex'])
                    check(case+'/next-round/unsubmitted'+str(slot), None, rounds[1][slot]['turns'][0]['gameObject'])
        activity=read(case+'/services/activity.jsonl','lines')
        check(case+'/runtime/mongo-connected', True, any(e['source']=='mongodb' and e['message']=='ping ok' for e in activity))
        log=read(case+'/services/server.log','text')
        check(case+'/runtime/committed-both', True, '@@handleNextTurn 1' in log and '@@handleNextTurn 2' in log)
        check(case+'/runtime/old-platform', case=='old-server', 'listening on wss://0.0.0.0:8080' in log)
        check(case+'/browser-errors', [], read(case+'/browser-errors.json'))
    for n in ['003-old-client-p1-version-rejected.png','004-old-client-p2-version-rejected.png']:
        check('visible-rejection/'+n, True, read('screenshots/'+n,'bytes').startswith(b'\x89PNG\r\n\x1a\n'))
    return dict(checks=checks,proofs=proofs,currentSourceValid=prior['currentSourceValid'],sourceMismatches=prior['sourceMismatches'],
                sourceHashes=prior['sourceHashes'],wholeCriterionClosure=True,fullAuditReady=False,
                scope='TASK-211/AC2: recorded-release pairings, rejected legacy UI/protocol/database, upgraded and old-server supported turn',
                derivation='Independent Python field projection; fixture plus town income 10, field noob upkeep 1, adjacent move cost 1 and round move reset 2. Original checkpoint expected/pass fields unused. Runtime identity follows hash-bound executed extractor/branch/spawn code plus observed old-platform log, served hashes and wire protocol. Both bound rejection PNGs visually inspected; read-only DOM checks and legacy wire sequence establish timing before authoritative mutation.')


if __name__=='__main__':
    print(json.dumps(review(sys.argv[1],sys.argv[2])))
