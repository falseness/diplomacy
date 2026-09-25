#!/usr/bin/env python3
"""Independently review TASK-209 state proofs for TASK-225, without running JS.

A historical semantic pass is not current coverage or a complete audit. Literal
geometry, economy and movement expectations below do not import the producer.
"""
import argparse
import datetime
import re
import hashlib
import json
from pathlib import Path


def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def entity(name, x, y, hp, **extra):
    return dict(name=name, coord=dict(x=x, y=y), hp=hp, wasHitted=False, **extra)


def board(label, round_number=0, moved=False, persisted=False):
    """Authored 14/30-square fixtures, town 4 + seven suburbs - unit salaries."""
    humans = 10 if label == 'coop-ten' else 2
    coop = label != 'competitive-browser'
    side = 30 if humans == 10 else 14
    grid = [[0] * side for _ in range(side)]
    players = [dict(gold=0, units=[], towns=[])]
    for i in range(humans):
        x, y = ((1 + i % 5 * 5, 1 + i // 5 * 9) if humans == 10
                else ((1, 1) if i == 0 else (9, 8)))
        neighbors = [(x, y), (x, y-1), (x+1, y-(1-x % 2)),
                     (x+1, y+x % 2), (x, y+1), (x-1, y+x % 2),
                     (x-1, y-(1-x % 2))]
        suburbs = [dict(x=a, y=b, isSuburb=True) for a, b in neighbors]
        for a, b in neighbors:
            grid[a][b] = i+1
        town = entity('town', x, y, 10, unitProduction={'name': 'Empty'},
                      isRecentlyCaptured=False, suburbs=suburbs, buildings=[], buildingProduction=[])
        units = [entity('noob', x, y, 2, moves=2)]
        if i == 0:
            dest_y = (6 if label == 'coop-ten' and round_number == 2 else 5) if moved else 6
            move_points = 1 if moved and (persisted or round_number == 0) else 2
            units.insert(0, entity('noob', 3, dest_y, 2, moves=move_points))
            grid[3][6] = 1
            if moved:
                grid[3][5] = 1
        income = 9 if i == 0 else 10
        players.append(dict(gold=200+30*i+income*(round_number+(0 if persisted else 1)),
                            units=units, towns=[town]))
    portals = []
    if coop:
        players.append(dict(gold=0, units=[entity('imp', side-4, 4, 2, moves=2)], towns=[]))
        grid[side-4][4] = humans+1
        cats = ['melee']*3 + ['ranged']*3 + ['siege', 'heavy', 'support', 'chaos']
        for i in range(10*humans):
            x, y = i % side, side-1-i//side
            portals.append(entity('demonPortal', x, y, 30, category=cats[i % 10]))
            grid[x][y] = humans+1
    mountains = [dict(name='mountain', coord=dict(x=x, y=y))
                 for x in range(side-6, side-1) for y in range(2, 7)
                 if (x, y) != (side-4, 4)]
    return dict(gameRound=round_number, grid=grid, players=players, external=portals,
                externalProduction=[], nature=mountains, goldmines=[])


def project(raw):
    """Read serialized fields only; never call production serialization."""
    def live(xs):
        return [x for x in xs or [] if not x.get('killed')]

    def item(x):
        result = {k: x.get(k) for k in ['name', 'coord', 'hp', 'wasHitted']}
        for k in ['moves', 'category']:
            if k in x:
                result[k] = x[k]
        if 'unitProduction' in x:
            p = x['unitProduction']
            result['unitProduction'] = ({k: p[k] for k in ['name', 'turns', 'cost']}
                                        if p and p.get('name') not in [None, 'Empty'] else {'name': 'Empty'})
        return result

    def town(x):
        return dict(item(x), isRecentlyCaptured=bool(x.get('isRecentlyCaptured')),
                    suburbs=[dict(h.get('coord', h), isSuburb=bool(h.get('isSuburb'))) for h in x['suburbs']],
                    buildings=[item(b) for b in live(x['buildings'])],
                    buildingProduction=[{k: b[k] for k in ['name', 'coord', 'turns']} for b in live(x['buildingProduction'])])
    return dict(gameRound=raw['gameRound'], grid=raw['grid'],
                players=[dict(gold=p['gold'], units=[item(u) for u in live(p.get('units'))],
                              towns=[town(t) for t in live(p.get('towns'))]) for p in raw['players']],
                external=[item(x) for x in live(raw.get('external'))],
                externalProduction=[{k: x[k] for k in ['name', 'coord', 'turns']} for x in live(raw.get('externalProduction'))],
                nature=sorted([{k: x[k] for k in ['name', 'coord']} for x in live(raw.get('nature'))],
                              key=lambda x: (x['coord']['x'], x['coord']['y'], x['name'])),
                goldmines=[{k: x[k] for k in ['name', 'coord', 'income']} for x in live(raw.get('goldmines'))])


def review(directory):
    root = Path(directory).resolve(strict=True)
    read = lambda n: json.loads((root/n).read_text())
    coverage = read('coverage-results.json')
    manifest = read('evidence-hashes.json') if (root/'evidence-hashes.json').exists() else coverage['evidenceHashes']
    for name, expected in manifest.items():
        p = (root/name).resolve(strict=True)
        if not p.is_relative_to(root) or not p.is_file() or digest(p) != expected:
            raise ValueError('evidence-hash-mismatch: '+name)
    checks, proofs = [], {}

    def bind(name):
        p = root/name
        if not p.is_file():
            raise ValueError('missing proof: '+name)
        proofs[name] = digest(p)
        return read(name)

    def check(name, expected, observed):
        ok = type(expected) is type(observed) and expected == observed
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': ok}))
        if not ok:
            raise ValueError('independent-observation-mismatch: '+name)

    plan = bind('verification-plan.json')
    check('cases', ['browser-pair', 'ten-socket-isolation'], [c['id'] for c in plan['cases']])
    check('completed-cases', ['browser-pair', 'ten-socket-isolation'], [c['id'] for c in coverage['cases'] if c['pass']])
    check('seed', 1, plan['seed'])
    check('contexts', 4, plan['browserContexts'])
    rows = bind('checkpoints.json')['checkpoints']
    index = {r['id']: r for r in rows}
    check('unique-checkpoints', len(rows), len(index))
    check('checkpoint-count', 142, len(rows))
    for r in rows:
        check('saved-pair/'+r['id'], r['expected'], r['observed'])
        check('saved-pass/'+r['id'], True, r['pass'])

    def assertion(name, expected):
        if name not in index:
            raise ValueError('missing checkpoint: '+name)
        for field in ['expected', 'observed']:
            check(name+'/'+field, expected, index[name][field])

    assertion('browser-pair/participants', dict(contexts=4, counts=[2, 2], distinctGames=2))
    assertion('ten-socket-isolation/participants', dict(identities=10, slots=list(range(1, 11)), persisted=10))
    for label in ['coop-browser', 'competitive-browser', 'coop-ten']:
        fixture = bind(label+'-fixture.json')
        check(label+'/fixture-label', label, fixture['spec']['label'])
        check(label+'/fixture-seed', 1, fixture['spec']['seed'])
        # All initial and advancing state fields are reconstructed, not copied
        # from checkpoint.expected or a production serializer.
        if label != 'coop-ten':
            for slot in range(2):
                assertion('browser-pair/initial/'+label+'/p'+str(slot), board(label))
                for r in [1, 2]:
                    assertion('browser-pair/round-'+str(r)+'/'+label+'/p'+str(slot), board(label, r, True))
                assertion('browser-pair/reconnected/'+label+'/p'+str(slot), board(label, 1, True))
            assertion('browser-pair/move/'+label+'/p0', board(label, 0, True))
        else:
            for slot in range(10):
                assertion('ten-socket-isolation/initial/'+str(slot), board(label))
                for r in [1, 2]:
                    assertion('ten-socket-isolation/round-'+str(r)+'/socket-'+str(slot), board(label, r, True))
                    expected = board(label, r-1, True)
                    # Second movement returns to y=6 before the second refresh.
                    if r == 2:
                        expected['players'][1]['units'][0]['coord']['y'] = 6
                    expected['players'][1]['units'][0]['moves'] = 1
                    assertion('ten-socket-isolation/move-'+str(r)+'/accepted-'+str(slot), expected)
            assertion('ten-socket-isolation/reconnect-exact', board(label, 1, True))
        for r in range(1, 5 if label == 'competitive-browser' else 3):
            assertion(label+'/persisted/'+str(r)+'/rounds', r+1)
            assertion(label+'/persisted/'+str(r)+'/revision', (10 if label == 'coop-ten' else 2)*r if label != 'competitive-browser' else 0)
            expected = board(label, r, True, persisted=True)
            if label != 'coop-ten' and r > 1:
                expected['players'][1]['units'][0]['moves'] = 2
            assertion(label+'/persisted/'+str(r)+'/board', expected)
            raw = bind(label+'-persisted-'+str(r)+'.json')
            check(label+'/raw-persistence/'+str(r), expected, project(raw['rounds'][-1][0]['parallelTurnResult']))

    trace_path = root/'game-isolation.jsonl'
    proofs['game-isolation.jsonl'] = digest(trace_path)
    trace = [json.loads(line) for line in trace_path.read_text().splitlines()]
    identities = {}
    for label, humans in [('coop-browser', 2), ('coop-ten', 10)]:
        events = [e for e in trace if e['id'] == label and e['event'] in ['gameStarted', 'playYourTurn', 'waitYouTurn']]
        ids = sorted(set(e['gameID'] for e in events))
        check(label+'/one-game-id', 1, len(ids))
        identities[label] = ids[0]
        check(label+'/all-slots', list(range(1, humans+1)), sorted(set(e['slot'] for e in events)))
        for r in [0, 1, 2]:
            check(label+'/round-slots/'+str(r), list(range(1, humans+1)), sorted(set(e['slot'] for e in events if e['round'] == r)))
        ai = bind(label+'-ai.json')
        check(label+'/real-ai', [(r, b, 1) for r in [0, 1] for b in ['start', 'end']],
              [(x['round'], x['boundary'], x['units']) for x in ai])
    check('separate-coop-game-ids', 2, len(set(identities.values())))
    for r in [1, 2]:
        accepted = [e for e in trace if e['event'] == 'movement-accepted-persisted-isolated' and e['round'] == r-1]
        check('movement-raw-count/'+str(r), 1, len(accepted))
        check('movement-raw-isolation/'+str(r), True, accepted[0]['concurrentGameUnchanged'])
        check('movement-raw-revision/'+str(r), (r-1)*10+1, accepted[0]['revision'])
        check('movement-raw-unit/'+str(r), entity('noob', 3, 5 if r == 1 else 6, 2, moves=1), accepted[0]['mover'])
    phases = bind('phase-snapshots.json')
    for label, gid in identities.items():
        check(label+'/phase-order', [(r, s) for r in [0, 1] for s in ['wave', 'demon', 'complete']],
              [(x['round'], x['stage']) for x in phases if x['gameID'] == gid])
    timings = bind('progress-timings.json')
    check('timing-selection', [('browser-pair', 'UI joining'), ('browser-pair', 'round 1'), ('browser-pair', 'round 2'),
                              ('ten-socket-isolation', 'join'), ('ten-socket-isolation', 'round 1'),
                              ('ten-socket-isolation', 'reconnect'), ('ten-socket-isolation', 'round 2')],
          [(r['id'], r['phase']) for r in timings])
    for r in timings:
        limit = 240000 if r['phase'] == 'UI joining' else 60000 if r['phase'].startswith('round') else 30000
        check('bound/'+r['id']+'/'+r['phase'], limit, r['boundMs'])
        check('elapsed/'+r['id']+'/'+r['phase'], True, 0 <= r['elapsedMs'] < limit)
    cleanup = bind('cleanup.json')
    check('owned-processes', ['server', 'mongod'], [p['role'] for p in cleanup['processes']])
    check('cleanup-processes', [False, False], [p['aliveAfter'] for p in cleanup['processes']])
    check('cleanup-directories', [False, False], [p['existsAfter'] for p in cleanup['directories']])
    budget = bind('verification-budget.json')
    check('budget/pass', True, budget['pass'])
    check('budget/cleanup', True, budget['cleanup'])
    check('budget/exits', [0], budget['exits'])
    check('budget/limits', [2700000, 3300000, 3600000], [budget[k] for k in ['targetMs', 'stopWorkMs', 'budgetMs']])
    stamp = lambda x: datetime.datetime.fromisoformat(x.replace('Z', '+00:00'))
    elapsed = (stamp(budget['finishedAt'])-stamp(budget['startedAt'])).total_seconds()*1000
    check('budget/arithmetic', True, abs(elapsed-budget['elapsedMs']) < 1)
    check('budget/within-target', True, 0 <= budget['elapsedMs'] <= 2700000)
    child = bind('child-results.json')['children']
    check('children/count', 1, len(child))
    for key, expected in [('exitCode', 0), ('signal', None), ('timedOut', False), ('status', 'passed')]:
        check('child/'+key, expected, child[0][key])
    for key, expected in [('pass', 1), ('fail', 0), ('cancelled', 0), ('skipped', 0), ('todo', 0)]:
        check('child/tap/'+key, expected, child[0]['tap']['summary'][key])
    stdout_name = 'children/001-reliability_concurrent-games/stdout.log'
    stdout = (root/stdout_name).read_text()
    proofs[stdout_name] = digest(root/stdout_name)
    check('child/raw-tap', True, bool(re.search(r'^ok 1 - bounded concurrent real games$', stdout, re.M)))
    check('child/runtime', True, '"node":"v20.20.2"' in stdout and '"chromium":' in stdout)
    for name in ['verification.log', 'children/001-reliability_concurrent-games/stderr.log',
                 'diplomacy-diff-check.txt', 'diplomacy_server-diff-check.txt']:
        proofs[name] = digest(root/name)
        if name != 'verification.log':
            check('empty/'+name, '', (root/name).read_text())
    identity = bind('source-identities.json')['after']
    differences = []
    for role, record in identity.items():
        for name, expected in record['files'].items():
            p = Path(record['repo'])/name
            actual = digest(p) if p.is_file() else None
            if actual != expected:
                differences.append(dict(role=role, file=name, expected=expected, observed=actual))
    # The semantic review must expose clauses that the selected archive cannot
    # prove. In particular a bounded two-game provider is not G09's three-game
    # database-await/long-phase concurrency scenario.
    return dict(schemaVersion=1, archive=str(root), semanticChecksPassed=True,
                checks=checks, proofs=proofs, evidenceHashes=len(manifest),
                sourceDifferences=differences, currentSourceValid=not differences,
                claims={'browserContexts': 4, 'browserGames': 2, 'protocolHumans': 10,
                        'naturalCombat': False, 'longDemonPhase': False,
                        'threeGamesAdvancingConcurrently': False},
                gaps={'G09': 'No interleaved advancement of two co-op matches plus competitive control; '
                      'coop-browser stops after round 2 before coop-ten advances. The single enclosed imp '
                      'does not establish a long busy demon phase across database awaits.',
                      'TASK-209/AC7': 'Plan declares seed/tiny/fog split, but no explicit simultaneous join-mode '
                      'journey: UI reconnect loops sequentially per game. Review independent provider proof before closure.'},
                fullAuditReady=False, criterionClosures=[])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive'); p.add_argument('output')
    args = p.parse_args()
    result = review(args.archive)
    with open(args.output, 'x') as stream:
        json.dump(result, stream, indent=2); stream.write('\n')
    print('PASS concurrent semantic checks='+str(len(result['checks']))+
          ' sourceDifferences='+str(len(result['sourceDifferences']))+' closures=0 fullAuditReady=false')
