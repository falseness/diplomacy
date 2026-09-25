#!/usr/bin/env python3
"""Read-only TASK-225 preflight for TASK-245 browser/network clause review.

This is deliberately not a tier supplement. Hashes and projected boards cannot
reconstruct full received states. Missing raw evidence leaves whole criteria
unresolved; this command exits 1 and never writes/promotes a crosswalk.
"""
import argparse
import collections
import datetime
import hashlib
import json
from pathlib import Path

CASE = 'browser-fog-upgraded'
CELLS = [('portal-empty', 'demonPortal', False), ('portal-occupied', 'demonPortal', False),
         ('mine-empty', 'goldmine', False), ('mine-occupied', 'goldmine', False),
         ('hidden-unit-only', 'Empty', False), ('empty-cell', 'Empty', False),
         ('visible-control', 'demonPortal', True)]


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def check_received_states(frames):
    """Report absence, never treat a digest/summary as a serialized board."""
    missing = []
    for player, event, slot in [('p0', 'playYourTurn', 1), ('p1', 'waitYouTurn', 2)]:
        received = [r for r in frames if r.get('player') == player and
                    r.get('direction') == 'received' and r.get('event') == event]
        if len(received) != 1 or received[0].get('whooseTurn') != slot:
            raise ValueError('recipient-identity/' + player)
        row = received[0]
        # The producer's trace schema has no payload field. A future producer
        # must declare its full-state schema and bind it before this check can
        # be replaced by a complete persistence/reload oracle.
        if 'grid' not in row or 'players' not in row:
            missing.append(dict(id='full-reloaded-state/' + player,
                case=CASE, event=event, revision=row.get('commit', {}).get('revision'),
                proof=CASE + '/network-trace.jsonl', availableKeys=sorted(row),
                missing='Full sanitized received board with entities, economy, current-format metadata and recipient identity; digest and summary are insufficient.'))
        else:
            raise ValueError('unsupported-full-state-schema: explicit semantic validation required')
    return missing


def review(directory):
    root = Path(directory).resolve(strict=True)
    coverage = json.loads((root/'coverage-results.json').read_text())
    manifest = json.loads((root/'evidence-hashes.json').read_text())
    for name, digest in coverage['evidenceHashes'].items():
        if manifest.get(name) != digest:
            raise ValueError('changed-original-index/' + name)
    if manifest.get('coverage-results.json') != sha(root/'coverage-results.json'):
        raise ValueError('changed-coverage-index')
    checks, proofs = [], {}

    def check(name, expected, observed):
        if expected != observed:
            raise ValueError(name + ': expected ' + repr(expected) + ', observed ' + repr(observed))
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    def bound(name):
        file = (root/name).resolve(strict=True)
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError('escaped-proof/' + name)
        if manifest.get(name) != sha(file):
            raise ValueError('changed-proof/' + name)
        proofs[name] = manifest[name]
        return file

    def read(name):
        return json.loads(bound(name).read_text())

    def rows(name):
        return [json.loads(line) for line in bound(name).read_text().splitlines()]

    source = read('source-identities.json')['files']
    differences = []
    for role, record in source.items():
        repo = Path(record['repo']).resolve(strict=True)
        for name, digest in record['files'].items():
            file = (repo/name).resolve()
            if not file.is_relative_to(repo):
                raise ValueError('escaped-source/' + name)
            if not file.is_file() or sha(file) != digest:
                differences.append(role+'/'+name)
    fixture = read(CASE+'/declared-fixture.json')
    board, spec = fixture['board'], fixture['spec']
    check('declared-fixture', [2, 'tiny', 1, 14], [spec[k] for k in ['humans', 'size', 'seed', 'side']])
    check('initial-round-fog', [4, True], [board['gameRound'], board['isFogOfWar']])
    generation = board['gameSettings']['coop']['generation']
    check('current-format', [4, 2, 'tiny', 1], [generation[k] for k in ['version', 'playerCount', 'size', 'seed']])
    check('authored-not-generated', False, generation['testFixture']['generated'])
    check('typed-quotas', dict(melee=6, ranged=6, siege=2, heavy=2, support=2, chaos=2),
          dict(collections.Counter(e['category'] for e in board['external'] if e['name']=='demonPortal')))
    result = read('browser-results.json')
    check('one-browser-journey', [CASE], result['cases'])
    data = result['rows']
    ids = [r['id'] for r in data]
    expected_ids = [CASE+'/'+name+'/'+suffix for name, kind, _ in CELLS
                    for suffix in (['stats', 'selection'] if kind=='demonPortal' else ['selection'])]
    expected_ids += [CASE+'/'+phase+'/selection' for phase in ['gained', 'lost']]
    check('exact-raw-observations', expected_ids, ids)
    by_id = {r['id']: r for r in data}
    get = lambda name: by_id[CASE+'/'+name]
    for name, kind, visible in CELLS:
        row = get(name+'/selection')
        observed = row['observed']
        check(name+'/selected', kind, observed['selected'])
        check(name+'/unit', False, observed['unit'])
        check(name+'/panel', kind != 'Empty', observed['visible'])
        check(name+'/vision', visible, observed['vision'])
        if kind != 'Empty':
            check(name+'/label', 'demon portal' if kind=='demonPortal' else kind, observed['info'])
        if kind=='goldmine':
            check(name+'/mine', 'income: 50\nrounds to open: 16', observed['text'])
        if kind=='demonPortal':
            unit, hp, dmg = ('spitter', 2, 1) if name=='portal-occupied' else ('clawling', 1, 2)
            check(name+'/stats', dict(name=unit, text=f'hp: {hp}\ndmg: {dmg}\nmovement: 2\nrange: 1'), get(name+'/stats')['observed'])
        check(name+'/inspection-unchanged', True, row['before']==row['after'])
    initial = get('portal-empty/selection')['before']
    gained, lost = [get(phase+'/selection') for phase in ['gained', 'lost']]
    for phase, row, y, moves, undo, vision in [('gained', gained, 6, 0, 1, 1), ('lost', lost, 4, 2, 0, 0)]:
        check(phase+'/inspection-unchanged', True, row['before']==row['after'])
        current = json.loads(row['before']['board'])
        scout = current['players'][1]['units'][0]
        check(phase+'/scout', ['noob', {'x':1, 'y':y}, 2, moves], [scout[k] for k in ['name','coord','hp','moves']])
        check(phase+'/undo', undo, len(json.loads(row['before']['undo'])))
        check(phase+'/portal-vision', vision, json.loads(row['before']['vision'])[2][8])
    check('undo-exact-restoration', True, initial==lost['before'])
    for row in data:
        check(row['id']+'/png', True, bound(row['screenshot']).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'))
    inputs = rows(CASE+'/input-trace.jsonl')
    frames = rows(CASE+'/network-trace.jsonl')
    for player in ['p0','p1']:
        check(player+'/reload-input', 1, sum(r['player']==player and r.get('action')=='reload' and r.get('label')=='identity reconnect' for r in inputs))
        check(player+'/tls-websocket', True, any(r['player']==player and r.get('type')=='websocket-open' and r['url'].startswith('wss://127.0.0.1:') for r in frames))
        check(player+'/two-human-lobby', True, any(r['player']==player and r.get('lobby')==dict(mode='coop',humanCapacity=2,occupiedHumans=2) for r in frames))
    check('undo-input', 1, sum(r.get('action')=='keyboard.press' and r.get('key')=='z' for r in inputs))
    for label in ['portal stats','portal back']:
        check(label+'/clicks', 3, sum(r.get('label')==label and r.get('via')=='mouse.click' for r in inputs))
    persisted = read(CASE+'/persisted.json')
    check('persistent-human-identities', 2, len(set(persisted['playerIndexToUserIndex'])-{None}))
    commits = [r for r in frames if r.get('commit')]
    check('recipient-slots', [1,2], [r['whooseTurn'] for r in commits])
    check('recipient-commit', [dict(gameID=persisted['gameID'],revision=0)]*2, [r['commit'] for r in commits])
    served = read(CASE+'/served-sources.json')
    for name, digest in served.items():
        check('served/'+name, source['client']['files'][name], digest)
    check('browser-errors', [], read(CASE+'/browser-errors.json'))
    cleanup = read(CASE+'/cleanup.json')
    check('closed-browser-client', [True,True], [cleanup[k] for k in ['browserClosed','clientClosed']])
    check('service-roles', ['mongod','server'], sorted(p['role'] for p in cleanup['cleanup']['processes']))
    check('dead-processes', [False,False], [p['aliveAfter'] for p in cleanup['cleanup']['processes']])
    check('removed-directories', True, bool(cleanup['cleanup']['directories']) and all(not d['existsAfter'] for d in cleanup['cleanup']['directories']))
    budget = read('verification-budget.json')
    stamp = lambda value: datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
    check('trace-run-window', True, all(stamp(budget['startedAt'])<=stamp(r['at'])<=stamp(budget['finishedAt']) for r in inputs+frames))
    plan = read('verification-plan.json')
    check('parent-child-case-binding', True, all(id in plan['cases'] for id in ids))
    check('parent-selected-case-binding', True, all(any(c['id']==id and c['pass'] for c in coverage['cases']) for id in ids))
    protocol = read('protocol/transport-manifest.json')
    check('separate-protocol-http', True, protocol['endpoint'].startswith('http://127.0.0.1:'))
    gaps = check_received_states(frames)
    return dict(schemaVersion=1, kind='incomplete-tier-readiness-review', archive=str(root),
        coverageSha256=sha(root/'coverage-results.json'), sourceSha256=manifest['source-identities.json'],
        checks=checks, proofs=proofs, sourceDifferences=differences, missingMilestones=gaps,
        readyForSupplement=False, wholeCriteriaClosed=[],
        limitation='Available UI observations are checked, but full received state for both reloaded browsers is absent. HTTP/in-memory protocol cannot replace HTTPS/MongoDB proof. No tier is assigned.',
        next='Add sanitized full inbound state capture for both recipients to the bounded browser producer, compare against the persisted current-format board, then run only the dependency-justified provider refresh. Keep original evidence and unresolved clauses.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive');p.add_argument('--output',required=True)
    a=p.parse_args();report=review(a.archive)
    with Path(a.output).open('x') as stream:
        json.dump(report,stream,indent=2);stream.write('\n')
    print('INCOMPLETE TASK-245/AC2,AC5: '+','.join(m['id'] for m in report['missingMilestones']))
    print('No whole criterion closed; no tier supplement emitted.')
    raise SystemExit(1)
