#!/usr/bin/env python3
"""Read-only TASK-225 prerequisite review of a bounded ticket-green archive.

This verifies specific tier/budget observations, not complete criterion coverage.
It never runs gameplay, edits an archive, or treats an unbound final receipt as
reviewed proof. Pair its output with exact clause reviews and full trace review.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def review(directory):
    root = Path(directory).resolve(strict=True)
    read = lambda name: json.loads((root / name).read_text())
    manifest = read('evidence-hashes.json')
    checks = []

    def check(name, expected, observed):
        checks.append({'id': name, 'expected': expected, 'observed': observed,
                       'pass': type(expected) is type(observed) and expected == observed})
        if not checks[-1]['pass']:
            raise ValueError(f'{name}: expected {expected!r}, observed {observed!r}')

    for name, expected in manifest.items():
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f'escaped or non-file proof: {name}')
        if digest(path) != expected:
            raise ValueError(f'evidence-hash-mismatch: {name}')
    check('archive-files-hash-valid', True, bool(manifest))
    identities = read('source-identities.json')['after']
    count = 0
    for identity in identities.values():
        for name, expected in identity['files'].items():
            if digest(Path(identity['repo']) / name) != expected:
                raise ValueError(f'current-source-mismatch: {name}')
            count += 1
    check('current-source-hashes-valid', True, count > 0)
    plan = read('verification-plan.json')
    check('selected-case-count', 25, len(plan['cases']))
    tiers = {c['id']: c['tier'] for c in plan['cases']}
    for name, tier in tiers.items():
        expected = ('shipped browser UI + real HTTPS/Socket.IO/MongoDB'
                    if '/fast-opening.test.js/' in name else
                    'real Socket.IO/MongoDB' if '/online/' in name else 'source-executed')
        check('tier/' + name, expected, tier)
    base = 'ticket-green/children/002-reliability_fast-opening/evidence/'
    competitive = base + 'competitive/competitive-1-tiny-deathmatch-h2-fog-on-simultaneous/'
    for label, prefix in [('coop', base + 'coop/'), ('competitive', competitive)]:
        lifecycle = read(prefix + 'service-lifecycle.json')
        readiness = lifecycle['readiness']
        for key, expected in [('statusCode', 200), ('authorized', True), ('engineHandshake', True)]:
            check(label + '/https/' + key, expected, readiness['https'][key])
        check(label + '/mongo/ping', 1, readiness['database']['ping'])
        check(label + '/mongo/collections', ['games', 'turns', 'users'], readiness['database']['collections'])
        check(label + '/socket/connected', True, readiness['socketIo']['connected'])
        check(label + '/socket/transport', 'websocket', readiness['socketIo']['transport'])
        check(label + '/real-processes', ['mongod', 'server'], [p['role'] for p in lifecycle['processes']])
        check(label + '/production-server', 'node --require remote-transport-local-tls.js index.js',
              next(p['command'] for p in lifecycle['processes'] if p['role'] == 'server'))
        check(label + '/startup-count', 1, len(lifecycle['phases']))
        check(label + '/startup-pass', True, lifecycle['phases'][0]['ok'])
        check(label + '/service-stderr', {'mongod': '', 'server': ''}, lifecycle['stderr'])
        check(label + '/browser-errors', [], read(prefix + 'browser-errors.json'))
    config = read(base + 'coop/diagnostic-config.json')
    check('coop/no-fault-preloads', [], config['serverPreloads'])
    check('coop/seed', 1, config['declared']['seed'])
    check('coop/humans', 2, config['declared']['humans'])
    rows = read('checkpoints.json')['checkpoints']
    by_id = {c['id']: c for c in rows}
    prefix = 'competitive/competitive-1-tiny-deathmatch-h2-fog-on-simultaneous:'
    expected = {'coop/coop:connected-contexts': 2, 'coop/coop:distinct-contexts': 2,
                'coop/coop:participants': 2, prefix+'distinct-contexts': 2,
                prefix+'occupied-slots': 2, prefix+'all-submitted': 2}
    for slot in [1, 2]:
        expected[prefix+str(slot)+':one-nextTurn'] = 1
        expected[prefix+str(slot)+':reconnected-slot'] = slot
        expected[prefix+str(slot)+':opening-economy'] = 1000+4+7-1
        expected[prefix+str(slot)+':round-one-economy'] = 1000+2*(4+7-1)
    for name, value in expected.items():
        check(name+'/expected', value, by_id[name]['expected'])
        check(name+'/observed', value, by_id[name]['observed'])
    # Final receipts are outside the worker manifest. Inspect their consistency
    # but explicitly report the missing binding instead of claiming AC9 closure.
    budget = read('verification-budget.json')
    stamp = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    elapsed = round((stamp(budget['finishedAt'])-stamp(budget['startedAt'])).total_seconds()*1000)
    check('budget/elapsed-arithmetic', elapsed, budget['elapsedMs'])
    check('budget/shared-start', plan['startedAt'], budget['startedAt'])
    check('budget/target', 2700000, budget['targetMs'])
    check('budget/stop', 3300000, budget['stopWorkMs'])
    check('budget/limit', 3600000, budget['budgetMs'])
    check('budget/within-target', True, 0 <= elapsed <= 2700000)
    check('budget/exits', [0, 0, 0], budget['exits'])
    check('budget/cleanup', True, budget['cleanup'])
    check('budget/timeout', False, budget['timedOut'])
    check('budget/invocation-exit', 0, budget['invocationExit'])
    for filename in ['owned.jsonl.cleanup.json', 'invocation-owned.jsonl.cleanup.json']:
        receipt = read(filename)
        for key, value in [('cleanup', True), ('timedOut', False), ('remaining', []), ('exit', 0)]:
            check(filename+'/'+key, value, receipt[key])
    unbound = [name for name in ['verification-budget.json', 'invocation-owned.jsonl.cleanup.json']
               if name not in manifest]
    return dict(pass_=True, archive=str(root), archiveManifestSha256=digest(root/'evidence-hashes.json'),
                evidenceHashes=len(manifest), sourceHashes=count, checks=checks,
                unboundFinalizationProof=unbound, finalizationReviewReady=not unbound,
                completeAudit=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('output', help='new local-only review report path')
    args = parser.parse_args()
    result = review(args.archive)
    with open(args.output, 'x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(f"PASS substantive tier/budget observations={len(result['checks'])} evidenceHashes={result['evidenceHashes']} sourceHashes={result['sourceHashes']}")
    if result['unboundFinalizationProof']:
        print('UNRESOLVED finalization proof binding: ' + ', '.join(result['unboundFinalizationProof']))
    print('INCOMPLETE full TASK-225 audit; this command reviews prerequisites only')


if __name__ == '__main__':
    main()
