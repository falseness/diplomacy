#!/usr/bin/env python3
"""Independently review TASK-244 local-fixture evidence for TASK-225.

No gameplay is executed and no tier is promoted. An output report alone does
not close a criterion: its bound original checkpoints must reach the consumer.
"""
import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path

MUTATIONS = ('generation-v1', 'generation-v2', 'generation-v3', 'missing-generation',
             'missing-size', 'old-balance', 'weighted-wave', 'untyped-portal')
CASES = ['current-create', 'current-advance', 'current-wave', 'current-reconnect'] + [
    p + '/' + m for m in MUTATIONS for p in ('creation', 'save')] + ['save/legacy-round', 'cleanup']
CATEGORIES = ['chaos', 'heavy', 'melee', 'ranged', 'siege', 'support']


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def mutate(board, name):
    coop = board['gameSettings']['coop']
    if name.startswith('generation-v'):
        coop['generation']['version'] = int(name[-1])
    elif name == 'missing-generation':
        del coop['generation']
    elif name == 'missing-size':
        del coop['generation']['size']
    elif name == 'old-balance':
        coop['balanceVersion'] = 1
    elif name == 'weighted-wave':
        coop['waveGeneration'] = dict(version=1, seed=1, lastRound=4)
    elif name == 'untyped-portal':
        del next(p for p in board['external'] if p['name'] == 'demonPortal')['category']
    else:
        raise ValueError('unknown mutation: ' + name)


def review(directory, require_current=True):
    root = Path(directory).resolve(strict=True)
    read = lambda name: json.loads((root / name).read_text())
    coverage, plan, budget = map(read, ['coverage-results.json', 'verification-plan.json', 'verification-budget.json'])
    manifest = coverage['evidenceHashes']
    checks = []

    def check(name, expected, observed):
        # JSON equality must distinguish booleans from numbers, including nested values.
        expected_json = json.dumps(expected, sort_keys=True)
        observed_json = json.dumps(observed, sort_keys=True)
        equal = expected_json == observed_json
        if not equal:
            raise ValueError('removal-review:' + name)
        if len(expected_json) > 2048:
            expected = {'sha256': hashlib.sha256(expected_json.encode()).hexdigest(), 'encoding': 'sorted JSON'}
            observed = {'sha256': hashlib.sha256(observed_json.encode()).hexdigest(), 'encoding': 'sorted JSON'}
        checks.append(dict(id=name, expected=expected, observed=observed, pass_=True))

    def bound(name):
        file = (root / name).resolve(strict=True)
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError('escaped or non-file proof: ' + name)
        check('hash/' + name, manifest[name], digest(file))

    for name in manifest:
        bound(name)
    for name in ['verification-plan.json', 'source-identities.json', 'checkpoints.json',
                 'request-traces.jsonl', 'state-traces.json', 'initial-fixture.json',
                 'obsolete-rejection-payloads.json', 'transport-manifest.json',
                 'removed-runtime-rg.txt', 'remaining-references-rg.txt', 'removal-inventory.json']:
        bound(name)
    sources = read('source-identities.json')['files']
    differences = []
    for role, record in sources.items():
        check('source-nonempty/' + role, True, bool(record['files']))
        repo = Path(record['repo']).resolve(strict=True)
        for name, sha in record['files'].items():
            file = (repo / name).resolve()
            if not file.is_relative_to(repo):
                raise ValueError('source path escape')
            if not file.is_file() or digest(file) != sha:
                differences.append(role + '/' + name)
    if require_current:
        check('current-source-differences', [], differences)
    check('exact-selected-cases', CASES, plan['cases'])
    check('exact-completed-cases', CASES, [c['id'] for c in coverage['cases']])
    check('case-pass', [True] * len(CASES), [c['pass'] for c in coverage['cases']])
    check('coverage-pass', True, coverage['pass'])
    check('budget-pass', True, budget['pass'])
    check('budget-cleanup', True, budget['cleanup'])
    check('bounded-estimate', True, 0 < plan['estimateMs'] <= 2700000)
    for key, expected in [('targetMs', 2700000), ('stopWorkMs', 3300000), ('budgetMs', 3600000)]:
        check('plan/' + key, expected, plan[key])
        check('budget/' + key, expected, budget[key])
    stamp = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    elapsed = round((stamp(budget['finishedAt']) - stamp(budget['startedAt'])).total_seconds() * 1000)
    check('elapsed-arithmetic', elapsed, budget['elapsedMs'])
    check('within-target', True, 0 <= elapsed <= 2700000)
    commands = coverage['commandExits']
    check('command-count', 9, len(commands))
    check('command-exits', [0, 0, 0, 1, 0, 0, 0, 0, 0], [c['exit'] for c in commands])
    check('budget-exits', [c['exit'] for c in commands], budget['exits'])
    for c in commands:
        check('command-status/' + str(c['args']), [c['expectedExit'], None, None], [c['exit'], c['signal'], c['error']])
    for name in ['removed-runtime-rg.txt', 'server-diff-check.txt', 'client-diff-check.txt']:
        check('empty/' + name, '', (root / name).read_text())
    log = (root / 'verification.log').read_text()
    for marker in ['PASS evidence-audit cases=22 rejection-payloads=17 current-rounds=4',
                   'PASS source-hashes-current artifacts-unstaged diff-check-empty removed-runtime-empty',
                   'PASS owned-process-cleanup sockets-closed service-closed child-reaped', 'RUNNER_ACTUAL_EXIT_STATUS=0']:
        check('log/' + marker, True, marker in log)
    for marker in ['COMMAND ', 'CWD=', 'NODE=', 'V8=', 'BROWSER=not used', 'SOCKET_IO_CLIENT=']:
        check('runtime/' + marker, True, marker in log)

    fixture = read('initial-fixture.json')['board']
    coop = fixture['gameSettings']['coop']
    check('fixture/generation', dict(version=4, playerCount=2, seed=1, size='tiny', options=dict(seed=1, size='tiny')), coop['generation'])
    check('fixture/slots', [1, 2], coop['humanSlots'])
    check('fixture/balance', 2, coop['balanceVersion'])
    check('fixture/demon-slot', 3, coop['demonSlot'])
    check('fixture/categories', CATEGORIES, sorted(set(p['category'] for p in fixture['external'] if p['name'] == 'demonPortal')))
    trace = [json.loads(line) for line in (root / 'request-traces.jsonl').read_text().splitlines()]
    ownership = read('transport-manifest.json')
    identities = [c['identity'] for c in ownership['identities']]
    check('identities/count', 10, len(set(identities)))
    check('identities/connected', identities, [r['identity'] for r in trace if r['type'] == 'connected'])
    check('tier/loopback-http', True, ownership['endpoint'].startswith('http://127.0.0.1:'))
    for r in trace:
        check('trace/run', [ownership['runID'], ownership['endpoint'], 1], [r['runID'], r['endpoint'], r['seed']])
    times = [stamp(r['time']) for r in trace]
    check('trace/monotonic', True, times == sorted(times))
    check('trace/within-invocation', True, stamp(budget['startedAt']) <= times[0] <= times[-1] <= stamp(budget['finishedAt']))
    check('trace/cleanup', 'cleanup', trace[-1]['type'])
    check('trace/sockets-closed', True, trace[-1]['socketsDisconnected'])
    check('trace/cleanup-identities', identities, trace[-1]['identities'])
    check('trace/game-count', 1, len(ownership['games']))
    game_id = ownership['games'][0]
    check('trace/cleanup-revision', [[game_id, 8]], trace[-1]['games'])
    requests = [r for r in trace if r['type'] == 'request']
    errors = [r for r in trace if r['type'] == 'receive' and r['event'] == 'error']
    check('trace/error-count', 17, len(errors))
    check('trace/error-identities', identities[:8] + [identities[8]] * 9, [r['identity'] for r in errors])
    payloads = read('obsolete-rejection-payloads.json')
    check('rejections/order', ['creation/' + m for m in MUTATIONS] + ['save/' + m for m in MUTATIONS] + ['save/legacy-round'], [p['id'] for p in payloads])
    for index, name in enumerate(MUTATIONS):
        expected = copy.deepcopy(fixture)
        mutate(expected, name)
        check('creation-payload/' + name, expected, payloads[index]['input'])
        check('creation-request/' + name, expected, requests[index]['game'])
    submissions = [r for r in requests if r['event'] == 'nextTurn']
    check('trace/submit-count', 8, len(submissions))
    check('trace/submit-identities', identities[8:] * 4, [r['identity'] for r in submissions])
    check('trace/submitted-rounds', [r for r in range(4) for _ in range(2)], [r['game']['gameRound'] for r in submissions])
    received = [r for r in trace if r['type'] == 'receive' and 'commit' in r]
    states = read('state-traces.json')
    check('states/rounds', [1, 2, 3, 4], [s['round'] for s in states])
    for identity in identities[8:]:
        check('trace/revisions/' + identity, list(range(9)), sorted(set(r['commit']['revision'] for r in received if r['identity'] == identity)))
    for revision in range(9):
        rows = [r for r in received if r['commit']['revision'] == revision]
        check('trace/recipients/' + str(revision), identities[8:], sorted(set(r['identity'] for r in rows), key=identities.index))
        # Recipient turn slots differ; every other committed field must agree.
        boards = []
        for r in rows:
            check('trace/commit-binding', dict(gameID=game_id, revision=revision), r['payload']['coopCommit'])
            board = copy.deepcopy(r['payload'])
            board.pop('coopCommit')
            board.pop('whooseTurn')
            check('trace/projected-gold/' + str(revision),
                  [10 * (revision // 2), 110 + 10 * (revision // 2),
                   100 + 10 * ((revision + 1) // 2), 0],
                  [p['gold'] for p in board['players']])
            boards.append(board)
        for board in boards[1:]:
            check('trace/same-revision-state/' + str(revision), boards[0], board)
        if revision and revision % 2 == 0:
            stored = copy.deepcopy(states[revision // 2 - 1]['stored'])
            stored.pop('whooseTurn')
            # The wire presents the next active human after its opening refresh.
            # Stored parallelTurnResult is the prior completed round; 4+7-1=10.
            stored['players'][1]['gold'] += 10
            check('trace/persisted-state/' + str(revision), stored, boards[0])
    for s in states:
        board, round_ = s['stored'], s['round']
        check('state/round', round_, board['gameRound'])
        # Each human has one town, seven suburbs and one noob: 4+7-1=10.
        check('state/gold/' + str(round_), [10 * round_, 100 + 10 * round_, 100 + 10 * round_, 0], [p['gold'] for p in board['players']])
        for slot in [1, 2]:
            check('state/human-unit/' + str(round_) + '/' + str(slot), fixture['players'][slot]['units'], board['players'][slot]['units'])
        check('state/wave/' + str(round_), ['imp'] * 6 + ['spitter'] * 6 if round_ == 4 else [], sorted(u['name'] for u in board['players'][3]['units']))
    check('state/typed-wave-round', 4, states[-1]['stored']['gameSettings']['coop']['typedWaves']['lastRound'])
    checkpoints = read('checkpoints.json')['checks']
    check('checkpoints/exact-ids', sorted(CASES), sorted(c['id'] for c in checkpoints))
    by_id = {c['id']: c for c in checkpoints}
    expected = {
        'current-create': dict(games=1, humans=2, categories=CATEGORIES),
        'current-advance': dict(rounds=5, revision=8, round=4),
        'current-wave': dict(marker=4, units=['imp'] * 6 + ['spitter'] * 6), 'cleanup': True}
    reconnect = by_id['current-reconnect']['expected']['rows']
    check('persistence/counts', [1, 2, 0], [len(reconnect[n]) for n in ['games', 'users', 'turns']])
    game = reconnect['games'][0]
    check('persistence/identity', game_id, game['gameID'])
    check('persistence/revision', 8, game['coopRevision'])
    check('persistence/round-count', 5, len(game['rounds']))
    check('persistence/user-identities', [c['userId'] for c in ownership['identities'][8:]], [u['userId'] for u in reconnect['users']])
    for index, s in enumerate(states, 1):
        check('persistence/round/' + str(index), s['stored'], game['rounds'][index][0]['parallelTurnResult'])
    expected['current-reconnect'] = dict(rows=reconnect, revision=8, round=4)
    for item in payloads:
        name = item['id']
        if name.startswith('creation/'):
            rows = dict(games=[], users=[], turns=[])
        else:
            mutated = copy.deepcopy(game)
            if name == 'save/legacy-round':
                del mutated['rounds'][-1][1]['componentResult']
            else:
                mutate(mutated['rounds'][0][0]['parallelTurnResult'], name.split('/')[1])
            check('save-payload/' + name, mutated, item['input'])
            rows = copy.deepcopy(reconnect)
            rows['games'] = [mutated]
        expected[name] = dict(event='error', rows=rows)
    assertions = []
    for name in CASES:
        c = by_id[name]
        check('checkpoint/pass/' + name, True, c['pass'])
        check('checkpoint/expected/' + name, expected[name], c['expected'])
        check('checkpoint/observed/' + name, expected[name], c['observed'])
        assertions.append(dict(id=name, expected=expected[name], proof=dict(file='checkpoints.json', sha256=digest(root / 'checkpoints.json'))))
    regression = read('creation-regression/checkpoints.json')
    check('regression/pass', True, regression['pass'])
    check('regression/count', 117, len(regression['checks']))
    for c in regression['checks']:
        check('regression/' + c['id'], c['expected'], c['observed'])
        check('regression/pass/' + c['id'], True, c['pass'])
    return dict(archive=str(root), tier='local-fixture', completeAudit=False,
                sourceDifferences=differences, checks=checks, assertions=assertions,
                evidenceHashes=len(manifest), sourceHashes=sum(len(r['files']) for r in sources.values()),
                originalFiles={str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*')) if p.is_file()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('output')
    parser.add_argument('--historical', action='store_true')
    args = parser.parse_args()
    result = review(args.archive, not args.historical)
    with open(args.output, 'x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(f"PASS removal archive: {len(result['checks'])} observations, 22 exact consumed assertions, tier=local-fixture")
    print('INCOMPLETE full TASK-225 audit; prior-target prerequisites remain')
